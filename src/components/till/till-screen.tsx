"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { Banknote, CreditCard, Minus, Plus, Printer, ScanBarcode, Search, Trash2, Volume2, VolumeX, WifiOff, RotateCcw } from "lucide-react";
import { Alert, Badge, Button, cx, inputClass } from "@/components/ui";
import { Dialog } from "@/components/dialog";
import { formatRand, parseRandToCents, centsToInput } from "@/lib/money";
import type { TillItem } from "@/lib/till-types";

type Line = { variantId: number; name: string; size: string; sku: string; unitPriceCents: number; quantity: number; onHand: number };
type Payment = { method: "cash"; tenderedCents: number } | { method: "card"; terminalApproved: true; reference: string };
type Pending = { key: string; lines: Line[]; payment: Payment; totalCents: number; status: "sending" | "unknown"; startedAt: string };
type Done = { saleId: string; receiptNo: string; totalCents: number; changeCents: number; method: "cash" | "card"; replayed: boolean };
type Issue = { variantId: number; kind: string; description: string; expectedUnitPriceCents?: number; currentUnitPriceCents?: number; requested?: number; available?: number };
type ApiError = { code: string; message: string; details?: { issues?: Issue[]; totalCents?: number } | null };
type Msg = { tone: "error" | "success" | "info" | "warn"; text: string } | null;

const BASKET_KEY = "till.basket.v1";
const PENDING_KEY = "till.pending.v1";

function load<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
}
function save(key: string, value: unknown) {
  try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

class NetworkError extends Error {}
async function call<T>(url: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; status: number; error: ApiError }> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) }, cache: "no-store" });
  } catch {
    throw new NetworkError("offline");
  }
  const body = await res.json().catch(() => ({}));
  if (res.ok) return { ok: true, data: body as T };
  return { ok: false, status: res.status, error: (body as { error?: ApiError }).error ?? { code: "SERVER", message: `Server error ${res.status}` } };
}

/** Short beep for scan feedback (WebAudio, no files). */
function beep(ok: boolean) {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.frequency.value = ok ? 1320 : 220; o.type = ok ? "sine" : "square";
    g.gain.value = 0.06; o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + (ok ? 0.07 : 0.25));
    o.onended = () => ctx.close();
  } catch { /* no audio */ }
}

const isTextField = (el: Element | null) =>
  !!el && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el as HTMLElement).isContentEditable);

export function TillScreen({ tillOpen, staffName }: { tillOpen: boolean; staffName: string }) {
  const [basket, setBasket] = useState<Line[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [lastScanId, setLastScanId] = useState<number | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [lineIssues, setLineIssues] = useState<Record<number, string>>({});
  const [online, setOnline] = useState(true);
  const [signedOut, setSignedOut] = useState(false);
  const [sound, setSound] = useState(true);
  const [busy, setBusy] = useState<null | "validate" | "submit" | "scan">(null);
  const [payOpen, setPayOpen] = useState(false);
  const [method, setMethod] = useState<"cash" | "card">("cash");
  const [tendered, setTendered] = useState("");
  const [cardRef, setCardRef] = useState("");
  const [payError, setPayError] = useState<string | null>(null);
  const [priceReview, setPriceReview] = useState<Issue[] | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [checkoutKey, setCheckoutKey] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<TillItem[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const scanRef = useRef<HTMLInputElement>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const scanSeq = useRef(0);

  // ---- persistence (basket survives refresh / power cut) -------------------
  useEffect(() => {
    setBasket(load<Line[]>(BASKET_KEY, []));
    setPending(load<Pending | null>(PENDING_KEY, null));
    setSound(load<boolean>("till.sound", true));
    setHydrated(true);
  }, []);
  useEffect(() => { if (hydrated) save(BASKET_KEY, basket); }, [basket, hydrated]);
  useEffect(() => { if (hydrated) save(PENDING_KEY, pending); }, [pending, hydrated]);
  useEffect(() => { if (hydrated) save("till.sound", sound); }, [sound, hydrated]);

  const lastScan = basket.find((l) => l.variantId === lastScanId) ?? null;
  const totalCents = useMemo(() => basket.reduce((s, l) => s + l.unitPriceCents * l.quantity, 0), [basket]);
  const itemCount = useMemo(() => basket.reduce((s, l) => s + l.quantity, 0), [basket]);

  // ---- focus management ------------------------------------------------------
  const refocusScan = useCallback(() => {
    requestAnimationFrame(() => {
      const active = document.activeElement;
      if (document.querySelector("[data-dialog-open]")) return;
      if (active !== scanRef.current && isTextField(active)) return; // never steal from qty/search/payment fields
      scanRef.current?.focus();
    });
  }, []);

  useEffect(() => {
    // A keyboard-wedge scanner types into whatever has focus. If nothing editable is focused,
    // send printable keys to the scan field so a scan is never lost.
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
      if (document.querySelector("[data-dialog-open]")) return;
      if (isTextField(document.activeElement)) return;
      scanRef.current?.focus();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, []);

  // ---- connectivity ----------------------------------------------------------
  const checkHealth = useCallback(async () => {
    try {
      const r = await fetch("/api/health", { cache: "no-store" });
      setOnline(r.ok);
    } catch { setOnline(false); }
  }, []);
  useEffect(() => {
    checkHealth();
    const t = setInterval(checkHealth, 10000);
    const on = () => checkHealth();
    const off = () => setOnline(false);
    window.addEventListener("online", on); window.addEventListener("offline", off);
    return () => { clearInterval(t); window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, [checkHealth]);

  const handleApiFailure = useCallback((status: number, error: ApiError) => {
    if (status === 401) { setSignedOut(true); return true; }
    setMsg({ tone: "error", text: error.message });
    return false;
  }, []);

  // ---- basket ops ------------------------------------------------------------
  const addItem = useCallback((item: TillItem, qty = 1) => {
    setBasket((b) => {
      const i = b.findIndex((l) => l.variantId === item.variantId);
      if (i >= 0) {
        const next = [...b];
        next[i] = { ...next[i], quantity: next[i].quantity + qty, onHand: item.onHand };
        return next;
      }
      return [...b, { variantId: item.variantId, name: item.name, size: item.size, sku: item.sku, unitPriceCents: item.priceCents, quantity: qty, onHand: item.onHand }];
    });
    setLastScanId(item.variantId);
    setLineIssues((li) => { const n = { ...li }; delete n[item.variantId]; return n; });
    setDone(null);
  }, []);

  const handleCode = useCallback(async (code: string, seq: number) => {
    setBusy("scan");
    try {
      const r = await call<{ item: TillItem }>(`/api/till/lookup?code=${encodeURIComponent(code)}`);
      if (r.ok) {
        addItem(r.data.item, 1);
        if (sound) beep(true);
        setMsg(null);
      } else {
        if (sound) beep(false);
        if (!handleApiFailure(r.status, r.error)) {
          setMsg({ tone: "error", text: `${r.error.message} The basket has not changed. Check the label or search by name.` });
        }
      }
    } catch {
      if (sound) beep(false);
      setOnline(false);
      setMsg({ tone: "error", text: `Could not look up ${code}: no connection. The basket has not changed.` });
    } finally {
      if (seq === scanSeq.current) setBusy(null);
    }
  }, [addItem, handleApiFailure, sound]);

  /** One complete scan (scanner sends code + Enter) = exactly one unit. */
  const onScanSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const input = scanRef.current;
    if (!input) return;
    const code = input.value.trim();
    input.value = "";
    if (!code || pending) return;
    const seq = ++scanSeq.current;
    queue.current = queue.current.then(() => handleCode(code, seq));
  };

  const setQty = (variantId: number, qty: number) => {
    if (!Number.isFinite(qty)) return;
    setBasket((b) => b.map((l) => (l.variantId === variantId ? { ...l, quantity: Math.max(1, Math.min(999, Math.floor(qty))) } : l)));
    setLineIssues((li) => { const n = { ...li }; delete n[variantId]; return n; });
  };
  const removeLine = (variantId: number) => {
    setBasket((b) => b.filter((l) => l.variantId !== variantId));
    setLineIssues((li) => { const n = { ...li }; delete n[variantId]; return n; });
    refocusScan();
  };
  const clearBasket = () => {
    if (basket.length && !window.confirm("Clear the whole basket? Nothing has been charged.")) return;
    setBasket([]); setLastScanId(null); setLineIssues({}); setCheckoutKey(null); setMsg(null); refocusScan();
  };

  // ---- search ----------------------------------------------------------------
  useEffect(() => {
    const term = search.trim();
    if (term.length < 2) { setResults(null); setSearchError(null); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await call<{ items: TillItem[] }>(`/api/till/search?q=${encodeURIComponent(term)}`);
        if (r.ok) { setResults(r.data.items); setSearchError(null); }
        else if (!handleApiFailure(r.status, r.error)) setSearchError(r.error.message);
      } catch { setSearchError("No connection — search is unavailable."); setOnline(false); }
      finally { setSearching(false); }
    }, 200);
    return () => clearTimeout(t);
  }, [search, handleApiFailure]);

  // ---- checkout ----------------------------------------------------------------
  const applyIssues = (issues: Issue[]) => {
    const map: Record<number, string> = {};
    for (const i of issues) {
      if (i.kind === "insufficient_stock") map[i.variantId] = `Only ${i.available} in stock — basket has ${i.requested}. Reduce the quantity or ask the owner to correct the count.`;
      if (i.kind === "inactive" || i.kind === "missing") map[i.variantId] = "No longer for sale — remove this line.";
    }
    setLineIssues(map);
    const prices = issues.filter((i) => i.kind === "price_changed");
    if (prices.length) setPriceReview(prices);
    else if (Object.keys(map).length) setMsg({ tone: "error", text: "Some lines need attention before taking payment (marked in red)." });
  };

  const takePayment = async () => {
    if (!basket.length || !online) return;
    setBusy("validate"); setMsg(null);
    try {
      const r = await call<{ ok: boolean; issues: Issue[]; totalCents: number }>("/api/checkout/validate", {
        method: "POST", body: JSON.stringify({ lines: basket.map((l) => ({ variantId: l.variantId, quantity: l.quantity, unitPriceCents: l.unitPriceCents })) }),
      });
      if (!r.ok) { handleApiFailure(r.status, r.error); return; }
      if (!r.data.ok) { applyIssues(r.data.issues); return; }
      setLineIssues({});
      setCheckoutKey((k) => k ?? crypto.randomUUID());
      setPayError(null); setTendered(""); setCardRef(""); setMethod("cash");
      setPayOpen(true);
    } catch { setOnline(false); setMsg({ tone: "error", text: "No connection. Payment cannot be taken while offline." }); }
    finally { setBusy(null); }
  };

  const acceptPrices = () => {
    if (!priceReview) return;
    setBasket((b) => b.map((l) => {
      const i = priceReview.find((p) => p.variantId === l.variantId);
      return i?.currentUnitPriceCents ? { ...l, unitPriceCents: i.currentUnitPriceCents } : l;
    }));
    setPriceReview(null);
    setMsg({ tone: "info", text: "New prices accepted. Check the total with the customer, then take payment." });
  };

  const finishSuccess = (p: Pending, result: { saleId: string; receiptNo: string; totalCents: number; changeCents: number; replayed: boolean }) => {
    setDone({ ...result, method: p.payment.method });
    setPending(null); setBasket([]); setLastScanId(null); setCheckoutKey(null); setPayOpen(false); setLineIssues({});
    setMsg(null);
  };

  const submit = async (p: Pending) => {
    setBusy("submit"); setPayError(null);
    setPending({ ...p, status: "sending" });
    try {
      const r = await call<{ saleId: string; receiptNo: string; totalCents: number; changeCents: number; replayed: boolean }>("/api/checkout", {
        method: "POST",
        body: JSON.stringify({ idempotencyKey: p.key, lines: p.lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity, unitPriceCents: l.unitPriceCents })), payment: p.payment }),
      });
      if (r.ok) { finishSuccess(p, r.data); return; }
      // The server answered with a definite refusal: the sale was NOT recorded.
      setPending(null);
      if (r.status === 401) { setSignedOut(true); setPending({ ...p, status: "unknown" }); return; }
      if (r.status >= 500) { setPending({ ...p, status: "unknown" }); setPayOpen(false); return; }
      const issues = r.error.details?.issues;
      if (issues?.length) { setPayOpen(false); applyIssues(issues); }
      const cardNote = p.payment.method === "card" ? " The card terminal may already show APPROVED — reverse it on the terminal if the sale cannot be completed." : "";
      setPayError(r.error.message + cardNote);
      if (issues?.length) setMsg({ tone: "error", text: r.error.message + cardNote });
    } catch {
      // No answer: the sale may or may not have committed. Keep the reference; never take payment again.
      setOnline(false);
      setPending({ ...p, status: "unknown" });
      setPayOpen(false);
    } finally { setBusy(null); }
  };

  const tenderedCents = parseRandToCents(tendered);
  const change = tenderedCents !== null ? tenderedCents - totalCents : null;

  const completeCash = () => {
    if (!checkoutKey || tenderedCents === null) return;
    if (tenderedCents < totalCents) { setPayError(`Cash tendered is ${formatRand(totalCents - tenderedCents)} short.`); return; }
    submit({ key: checkoutKey, lines: basket, payment: { method: "cash", tenderedCents }, totalCents, status: "sending", startedAt: new Date().toISOString() });
  };
  const completeCard = () => {
    if (!checkoutKey) return;
    submit({ key: checkoutKey, lines: basket, payment: { method: "card", terminalApproved: true, reference: cardRef.trim() }, totalCents, status: "sending", startedAt: new Date().toISOString() });
  };
  const declined = async () => {
    if (!checkoutKey) return;
    try { await call("/api/checkout/declined", { method: "POST", body: JSON.stringify({ checkoutRef: checkoutKey, amountCents: totalCents, note: "Terminal declined" }) }); } catch { /* audit only */ }
    setPayError("Card declined by the terminal. Nothing was charged. Ask for another card or take cash.");
    setMethod("cash");
  };

  const recover = async () => {
    if (!pending) return;
    try {
      const r = await call<{ sale: Done | null }>(`/api/checkout/status?key=${pending.key}`);
      if (r.ok && r.data.sale) { finishSuccess(pending, r.data.sale); return; }
      if (!r.ok) { handleApiFailure(r.status, r.error); return; }
      // Not recorded yet: finish the SAME checkout (same reference) — no new payment.
      await submit(pending);
    } catch { setOnline(false); }
  };
  const abandonPending = () => {
    if (!pending) return;
    if (!window.confirm("Only do this if you are sure the customer was NOT charged. Return to the basket?")) return;
    setBasket(pending.lines); setPending(null);
  };

  const printReceipt = (saleId: string, size: "80mm" | "a4") => {
    window.open(`/print/receipt/${saleId}?size=${size}&auto=1`, "_blank", "noopener");
  };

  const quickCash = useMemo(() => {
    const notes = [1000, 2000, 5000, 10000, 20000];
    const out = new Set<number>([totalCents]);
    for (const n of notes) { const v = Math.ceil(totalCents / n) * n; if (v >= totalCents) out.add(v); }
    return [...out].sort((a, b) => a - b).slice(0, 5);
  }, [totalCents]);

  const checkoutDisabled = !online || basket.length === 0 || !!pending || !tillOpen || busy === "validate";

  // ---------------------------------------------------------------------------
  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      {/* LEFT: scan & search */}
      <div className="flex min-w-0 flex-1 flex-col gap-4 p-4 pb-4 md:overflow-y-auto">
        {!online && (
          <Alert tone="error" title="Offline — checkout is disabled">
            The till cannot reach the server. Keep the customer&apos;s items aside; you can finish the sale when the connection returns.
          </Alert>
        )}
        {signedOut && (
          <Alert tone="error" title="You have been signed out">
            The basket is kept on this device. <Link className="underline" href="/login?next=/till">Sign in again</Link> to continue.
          </Alert>
        )}
        {!tillOpen && (
          <Alert tone="warn" title="The till is not open">
            Count the opening float first. <Link className="font-semibold underline" href="/till/cash">Open the till</Link>
          </Alert>
        )}
        {pending && (
          <Alert tone="warn" title={pending.status === "sending" ? "Completing sale…" : "Connection lost while completing a sale"}>
            <p>Checkout reference <span className="font-mono font-semibold">{pending.key.slice(0, 8).toUpperCase()}</span> for <strong>{formatRand(pending.totalCents)}</strong> ({pending.payment.method === "card" ? "card" : "cash"}).
              {" "}<strong>Do not take payment again.</strong> Use “Check and finish sale” — it looks up the sale and completes the same checkout if it was not recorded.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button onClick={recover} busy={busy === "submit"} disabled={pending.status === "sending" && busy === "submit"}>
                <RotateCcw className="size-4" aria-hidden /> Check and finish sale
              </Button>
              <Button variant="secondary" onClick={abandonPending} disabled={busy === "submit"}>Customer was not charged — back to basket</Button>
            </div>
          </Alert>
        )}

        <form onSubmit={onScanSubmit} className="rounded-xl border border-line bg-surface p-4" autoComplete="off">
          <label htmlFor="scan" className="flex items-center gap-2 text-sm font-semibold">
            <ScanBarcode className="size-5 text-forest" aria-hidden /> Scan barcode
          </label>
          <div className="mt-2 flex gap-2">
            <input id="scan" ref={scanRef} name="scan" autoFocus inputMode="text" enterKeyHint="enter" spellCheck={false}
              className={cx(inputClass, "min-h-14 font-mono text-xl tracking-wider")} placeholder="Scan or type code"
              aria-describedby="scan-help" disabled={!!pending} data-testid="scan-input" />
            <Button type="submit" size="lg" variant="secondary" disabled={!!pending}>Add</Button>
          </div>
          <p id="scan-help" className="mt-2 text-xs text-muted">Each scan adds one item. Scan the same pot twice to sell two.</p>
          <div aria-live="polite" className="mt-3 min-h-12">
            {lastScan ? (
              <div className="flex items-center justify-between gap-3 rounded-lg bg-leaf px-3 py-2" data-testid="last-scan">
                <div className="min-w-0">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted">Last item</p>
                  <p className="truncate font-semibold">{lastScan.name} — {lastScan.size}</p>
                </div>
                <p className="shrink-0 text-right"><span className="text-xs text-muted">Qty in basket</span><br /><span className="tabular text-2xl font-bold">{lastScan.quantity}</span></p>
              </div>
            ) : busy === "scan" ? <p className="text-sm text-muted">Looking up…</p> : null}
          </div>
          {msg && <Alert tone={msg.tone} className="mt-2">{msg.text}</Alert>}
        </form>

        <section className="rounded-xl border border-line bg-surface p-4" aria-labelledby="search-label">
          <label id="search-label" htmlFor="search" className="flex items-center gap-2 text-sm font-semibold">
            <Search className="size-5 text-forest" aria-hidden /> Find by name or SKU
          </label>
          <input id="search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} className={cx(inputClass, "mt-2")}
            placeholder="e.g. lavender, LAV-15" autoComplete="off" />
          <div className="mt-3" aria-live="polite">
            {searching && <p className="text-sm text-muted">Searching…</p>}
            {searchError && <Alert tone="error">{searchError}</Alert>}
            {results && !searching && results.length === 0 && <p className="text-sm text-muted">Nothing matches “{search}”.</p>}
            {results && results.length > 0 && (
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {results.map((r) => (
                  <li key={r.variantId}>
                    <button type="button" onClick={() => { addItem(r, 1); refocusScan(); }} disabled={!!pending}
                      className="flex min-h-16 w-full flex-col items-start rounded-lg border border-line bg-surface px-3 py-2 text-left hover:border-forest hover:bg-leaf">
                      <span className="font-semibold">{r.name}</span>
                      <span className="flex w-full justify-between gap-2 text-sm text-muted">
                        <span>{r.size}</span><span className="tabular font-semibold text-ink">{formatRand(r.priceCents)}</span>
                      </span>
                      <span className="text-xs text-muted">{r.sku} · {r.onHand} in stock</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {done && (
          <section className="rounded-xl border-2 border-forest bg-surface p-5" aria-live="assertive" data-testid="sale-done">
            <p className="text-sm font-semibold uppercase tracking-wide text-forest">Sale complete{done.replayed ? " (already recorded)" : ""}</p>
            <p className="mt-1 text-lg">Receipt <span className="font-mono font-semibold" data-testid="receipt-no">{done.receiptNo}</span> · {formatRand(done.totalCents)} {done.method === "card" ? "by card" : "cash"}</p>
            {done.method === "cash" && (
              <p className="mt-3"><span className="text-sm text-muted">Change to give</span><br />
                <span className="tabular text-5xl font-bold" data-testid="change-due">{formatRand(done.changeCents)}</span></p>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button onClick={() => printReceipt(done.saleId, "80mm")}><Printer className="size-4" aria-hidden /> Print receipt</Button>
              <Button variant="secondary" onClick={() => printReceipt(done.saleId, "a4")}>A4 receipt</Button>
              <Link className="inline-flex min-h-11 items-center px-3 text-sm font-semibold text-forest underline" href={`/till/receipts/${done.saleId}`}>View receipt</Link>
              <Button variant="ghost" onClick={() => { setDone(null); refocusScan(); }}>Next customer</Button>
            </div>
          </section>
        )}
      </div>

      {/* RIGHT: basket, total, payment */}
      <aside className="flex w-full flex-col border-t border-line bg-surface pb-44 md:w-1/2 md:max-w-xl md:border-t-0 md:border-l md:pb-0 lg:w-[44%]" aria-label="Basket">
        <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
          <h2 className="text-lg font-semibold">Basket <span className="text-sm font-normal text-muted">({itemCount} item{itemCount === 1 ? "" : "s"})</span></h2>
          <div className="flex gap-1">
            <button type="button" onClick={() => setSound((s) => !s)} className="inline-flex size-11 items-center justify-center rounded-lg hover:bg-mist" aria-label={sound ? "Turn scan sounds off" : "Turn scan sounds on"} title={sound ? "Sound on" : "Sound off"}>
              {sound ? <Volume2 className="size-5" aria-hidden /> : <VolumeX className="size-5" aria-hidden />}
            </button>
            <Button variant="ghost" onClick={clearBasket} disabled={!basket.length || !!pending}>Clear</Button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {basket.length === 0 ? (
            <div className="p-8 text-center text-muted">
              <p className="font-semibold text-ink">The basket is empty</p>
              <p className="mt-1 text-sm">Scan a label to start a sale.</p>
            </div>
          ) : (
            <ul className="divide-y divide-line" data-testid="basket">
              {basket.map((l) => {
                const issue = lineIssues[l.variantId];
                const overStock = l.quantity > l.onHand;
                return (
                  <li key={l.variantId} className={cx("px-4 py-3", issue ? "bg-danger-bg" : lastScanId === l.variantId ? "bg-leaf/60" : "")} data-testid="basket-line">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold leading-tight">{l.name}</p>
                        <p className="text-sm text-muted">{l.size} · <span className="tabular">{formatRand(l.unitPriceCents)}</span> each</p>
                      </div>
                      <p className="tabular shrink-0 text-xl font-bold" data-testid="line-total">{formatRand(l.unitPriceCents * l.quantity)}</p>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1">
                        <button type="button" className="inline-flex size-12 items-center justify-center rounded-lg border border-line hover:bg-leaf disabled:opacity-40"
                          onClick={() => { setQty(l.variantId, l.quantity - 1); refocusScan(); }} disabled={l.quantity <= 1 || !!pending} aria-label={`One fewer ${l.name}`}>
                          <Minus className="size-5" aria-hidden />
                        </button>
                        <label className="sr-only" htmlFor={`qty-${l.variantId}`}>Quantity of {l.name} {l.size}</label>
                        <input id={`qty-${l.variantId}`} type="number" inputMode="numeric" min={1} max={999} value={l.quantity} disabled={!!pending}
                          onChange={(e) => setQty(l.variantId, Number(e.target.value))} data-testid="line-qty"
                          className="tabular h-12 w-16 rounded-lg border border-line text-center text-2xl font-bold" />
                        <button type="button" className="inline-flex size-12 items-center justify-center rounded-lg border border-line hover:bg-leaf disabled:opacity-40"
                          onClick={() => { setQty(l.variantId, l.quantity + 1); refocusScan(); }} disabled={!!pending} aria-label={`One more ${l.name}`}>
                          <Plus className="size-5" aria-hidden />
                        </button>
                      </div>
                      <button type="button" onClick={() => removeLine(l.variantId)} disabled={!!pending}
                        className="inline-flex min-h-11 items-center gap-1 rounded-lg px-3 text-sm font-medium text-danger hover:bg-danger-bg" aria-label={`Remove ${l.name} ${l.size}`}>
                        <Trash2 className="size-4" aria-hidden /> Remove
                      </button>
                    </div>
                    {issue && <p className="mt-2 text-sm font-medium text-danger" role="alert">{issue}</p>}
                    {!issue && overStock && <p className="mt-2 text-sm text-warn">Stock record shows {l.onHand}. Checkout will be refused unless the count is corrected.</p>}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {/* Total + checkout: sticky at the bottom on tablet/phone so it is always visible */}
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface p-4 shadow-[0_-4px_16px_rgba(32,48,40,0.08)] md:sticky md:bottom-0 md:shadow-none">
          <div className="flex items-end justify-between gap-4">
            <span className="text-sm font-semibold uppercase tracking-wide text-muted">Amount due</span>
            <span className="tabular text-4xl font-bold sm:text-5xl" data-testid="amount-due">{formatRand(totalCents)}</span>
          </div>
          <Button size="xl" className="mt-3 w-full" onClick={takePayment} disabled={checkoutDisabled} busy={busy === "validate"} data-testid="take-payment">
            {online ? "Take payment" : <><WifiOff className="size-5" aria-hidden /> Offline — checkout disabled</>}
          </Button>
          <p className="mt-2 text-center text-xs text-muted">Signed in as {staffName}</p>
        </div>
      </aside>

      {/* Price change review — must be accepted before tender */}
      <Dialog open={!!priceReview} onClose={() => setPriceReview(null)} title="Prices have changed">
        <p className="text-sm text-muted">The owner changed these prices after they were added. Tell the customer and accept the new prices to continue.</p>
        <ul className="mt-4 divide-y divide-line rounded-lg border border-line">
          {priceReview?.map((i) => {
            const diff = (i.currentUnitPriceCents ?? 0) - (i.expectedUnitPriceCents ?? 0);
            return (
              <li key={i.variantId} className="flex items-center justify-between gap-3 p-3">
                <span className="font-medium">{i.description}</span>
                <span className="tabular text-right text-sm">
                  <s className="text-muted">{formatRand(i.expectedUnitPriceCents ?? 0)}</s> → <strong className="text-base">{formatRand(i.currentUnitPriceCents ?? 0)}</strong>
                  <br /><span className={diff > 0 ? "text-warn" : "text-forest"}>{diff > 0 ? "+" : "−"}{formatRand(Math.abs(diff))} each</span>
                </span>
              </li>
            );
          })}
        </ul>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={() => setPriceReview(null)}>Back to basket</Button>
          <Button onClick={acceptPrices} data-autofocus>Accept new prices</Button>
        </div>
      </Dialog>

      {/* Payment */}
      <Dialog open={payOpen} onClose={() => busy !== "submit" && setPayOpen(false)} title="Take payment" locked={busy === "submit"}>
        <div className="rounded-lg bg-leaf p-4 text-center">
          <p className="text-sm font-semibold uppercase tracking-wide text-muted">Amount due</p>
          <p className="tabular text-5xl font-bold" data-testid="pay-due">{formatRand(totalCents)}</p>
          {checkoutKey && <p className="mt-1 text-xs text-muted">Checkout ref <span className="font-mono">{checkoutKey.slice(0, 8).toUpperCase()}</span></p>}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Payment method">
          {(["cash", "card"] as const).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={method === m} onClick={() => { setMethod(m); setPayError(null); }}
              className={cx("flex min-h-14 items-center justify-center gap-2 rounded-lg border-2 text-lg font-semibold",
                method === m ? "border-forest bg-leaf text-forest" : "border-line bg-surface")}>
              {m === "cash" ? <Banknote className="size-6" aria-hidden /> : <CreditCard className="size-6" aria-hidden />} {m === "cash" ? "Cash" : "Card"}
            </button>
          ))}
        </div>

        {method === "cash" ? (
          <form className="mt-4" onSubmit={(e) => { e.preventDefault(); completeCash(); }}>
            <label htmlFor="tendered" className="text-sm font-medium">Cash received (R)</label>
            <input id="tendered" inputMode="decimal" autoComplete="off" value={tendered} onChange={(e) => { setTendered(e.target.value); setPayError(null); }}
              className={cx(inputClass, "tabular mt-1 min-h-14 text-3xl font-bold")} placeholder="0.00" data-autofocus data-testid="tendered" />
            <div className="mt-2 flex flex-wrap gap-2">
              {quickCash.map((c) => (
                <button key={c} type="button" onClick={() => setTendered(centsToInput(c))} className="tabular min-h-11 rounded-lg border border-line px-3 font-semibold hover:bg-leaf">
                  {c === totalCents ? `Exact ${formatRand(c)}` : formatRand(c)}
                </button>
              ))}
            </div>
            <div className="mt-4 flex items-end justify-between rounded-lg border border-line p-3">
              <span className="text-sm font-semibold uppercase tracking-wide text-muted">Change</span>
              <span className={cx("tabular text-4xl font-bold", change !== null && change < 0 && "text-danger")} data-testid="change-preview">
                {tendered === "" ? "—" : tenderedCents === null ? "Check amount" : change! < 0 ? `${formatRand(-change!)} short` : formatRand(change!)}
              </span>
            </div>
            {payError && <Alert tone="error" className="mt-3">{payError}</Alert>}
            <Button type="submit" size="xl" className="mt-4 w-full" busy={busy === "submit"} data-testid="complete-cash"
              disabled={!online || tenderedCents === null || (change ?? -1) < 0}>
              Complete cash sale
            </Button>
          </form>
        ) : (
          <div className="mt-4">
            <ol className="list-decimal space-y-1 pl-5 text-sm">
              <li>Key <strong className="tabular">{formatRand(totalCents)}</strong> into the card terminal.</li>
              <li>The customer taps or inserts their card <em>on the terminal</em>. Never type card numbers here.</li>
              <li>Wait for <strong>APPROVED</strong> on the terminal screen or slip.</li>
            </ol>
            <label htmlFor="card-ref" className="mt-4 block text-sm font-medium">Terminal reference (optional)</label>
            <input id="card-ref" value={cardRef} onChange={(e) => setCardRef(e.target.value)} maxLength={40} autoComplete="off"
              className={cx(inputClass, "mt-1")} placeholder="e.g. auth code from the slip" data-testid="card-ref" />
            {payError && <Alert tone="error" className="mt-3">{payError}</Alert>}
            <div className="mt-4 grid gap-2">
              <Button size="xl" onClick={completeCard} busy={busy === "submit"} disabled={!online} data-testid="card-approved">Terminal shows APPROVED — complete sale</Button>
              <Button variant="danger" onClick={declined} disabled={busy === "submit"} data-testid="card-declined">Terminal declined</Button>
            </div>
          </div>
        )}
        {!online && <Alert tone="error" className="mt-3">Offline — completing the sale is disabled until the connection returns.</Alert>}
      </Dialog>
    </div>
  );
}

export function TillStatusBadge({ open }: { open: boolean }) {
  return open ? <Badge tone="green">Till open</Badge> : <Badge tone="warn">Till closed</Badge>;
}
