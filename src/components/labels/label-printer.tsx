"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Barcode, Check, ChevronDown, Download, FlaskConical, LayoutGrid, Minus, Plus, Printer, RefreshCw, ScanBarcode, Search, Settings2, Tag, X } from "lucide-react";
import { Alert, Button, cx } from "@/components/ui";
import { formatRand } from "@/lib/money";
import { formatDateTime } from "@/lib/dates";
import { createPrintJobAction, searchVariantsAction } from "@/app/admin/actions";
import { acknowledgeRelabelAction } from "@/app/till/actions";
import { PdfPreview } from "./pdf-preview";

export type PrintItem = { variantId: number; name: string; size: string; priceCents: number; quantity: number; barcode: string };
type Preset = { id: number; name: string; kind: "roll" | "sheet"; slots: number; columns: number; rows: number; labelWidthMm: number; labelHeightMm: number; pageWidthMm: number; pageHeightMm: number; isDefault: boolean };
type Relabel = { variantId: number; name: string; size: string; priceCents: number; oldCents: number | null; barcode: string };
type Recent = { id: number; purpose: string; count: number; at: string; preset: string; by: string; items: { variantId: number; quantity: number }[] };

const PURPOSE: Record<string, string> = { delivery: "Delivery", batch: "Batch", reprint: "Reprint", test: "Test label", relabel: "Replacement" };

function StepTitle({ n, title, hint }: { n: number; title: string; hint?: string }) {
  return (
    <div className="mb-4 flex items-start gap-3">
      <span className="tabular inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-deep text-sm font-bold text-white">{n}</span>
      <div><h2 className="text-lg font-semibold leading-tight">{title}</h2>{hint && <p className="text-sm text-muted">{hint}</p>}</div>
    </div>
  );
}

/** Mini picture of the label paper, used on the paper cards. */
function PaperArt({ p, start, onPick }: { p: Preset; start: number; onPick?: (n: number) => void }) {
  if (p.kind === "roll") {
    return (
      <svg viewBox="0 0 120 64" className="h-16 w-full" aria-hidden>
        <circle cx="22" cy="32" r="18" fill="#ECFCCB" stroke="#365314" strokeWidth="2" /><circle cx="22" cy="32" r="6" fill="#fff" stroke="#365314" strokeWidth="2" />
        <path d="M22 14h74a4 4 0 0 1 4 4v28a4 4 0 0 1-4 4H22" fill="#fff" stroke="#365314" strokeWidth="2" />
        <rect x="46" y="20" width="44" height="24" rx="3" fill="#fff" stroke="#879189" strokeDasharray="3 2" />
        {[50, 53, 55, 58, 61, 63, 66, 69, 71, 74].map((x, i) => <rect key={i} x={x} y="32" width={i % 3 ? 1.2 : 2} height="8" fill="#17211B" />)}
        <rect x="50" y="24" width="22" height="3" rx="1" fill="#17211B" />
      </svg>
    );
  }
  return (
    <div className="grid w-full gap-[3px] rounded-lg bg-mist p-1.5 ring-1 ring-line" style={{ gridTemplateColumns: `repeat(${p.columns}, 1fr)` }}
      role={onPick ? "group" : undefined} aria-label={onPick ? "Choose the first free label on the sheet" : undefined}>
      {Array.from({ length: p.slots }, (_, i) => {
        const used = i + 1 < start, first = i + 1 === start;
        const cls = cx("h-3 rounded-[3px] transition-colors", used ? "bg-[repeating-linear-gradient(135deg,#d5ddd7_0_2px,transparent_2px_5px)] ring-1 ring-line" : first ? "bg-deep" : "bg-white ring-1 ring-line");
        return onPick
          ? <button key={i} type="button" onClick={() => onPick(i + 1)} aria-label={`Start at label ${i + 1}`} aria-pressed={first}
              className={cx(cls, "h-6 hover:ring-2 hover:ring-deep/60")} />
          : <span key={i} className={cls} />;
      })}
    </div>
  );
}

export function LabelPrinter({ presets, initialItems, initialPurpose, deliveryId, initialJobId, initialPresetId, relabel, recent, isOwner }: {
  presets: Preset[]; initialItems: PrintItem[]; initialPurpose: "batch" | "delivery"; deliveryId?: number; initialJobId?: number; initialPresetId?: number;
  relabel: Relabel[]; recent: Recent[]; isOwner: boolean;
}) {
  const [presetId, setPresetId] = useState(initialPresetId ?? presets.find((p) => p.isDefault)?.id ?? presets[0]?.id);
  const [items, setItems] = useState<PrintItem[]>(initialItems);
  const [purpose, setPurpose] = useState<"batch" | "delivery" | "relabel" | "reprint">(initialPurpose);
  const [start, setStart] = useState(1);
  const [jobId, setJobId] = useState<number | undefined>(initialJobId);
  const [busy, setBusy] = useState<null | "print" | "test" | "relabel">(null);
  const [error, setError] = useState<string | null>(null);
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<PrintItem[] | null>(null);
  const [active, setActive] = useState(0);
  const [relabelDone, setRelabelDone] = useState<number[]>([]);
  const [showTips, setShowTips] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const preset = presets.find((p) => p.id === presetId);
  const count = items.reduce((s, i) => s + i.quantity, 0);
  const pages = preset ? (preset.kind === "roll" ? count : Math.ceil((count + start - 1) / preset.slots)) : 0;
  const pendingRelabel = relabel.filter((r) => !relabelDone.includes(r.variantId));

  useEffect(() => {
    const t = term.trim();
    if (t.length < 2) { setResults(null); return; }
    const h = setTimeout(async () => {
      const r = await searchVariantsAction(t).catch(() => []);
      setResults(r.map((v) => ({ variantId: v.id, name: v.common_name, size: v.size_label, priceCents: v.price_cents, quantity: 1, barcode: v.barcode }))); setActive(0);
    }, 180);
    return () => clearTimeout(h);
  }, [term]);

  const changed = () => setJobId(undefined);
  const add = (it: PrintItem) => {
    setItems((xs) => (xs.some((x) => x.variantId === it.variantId) ? xs.map((x) => (x.variantId === it.variantId ? { ...x, quantity: x.quantity + it.quantity } : x)) : [...xs, it]));
    setTerm(""); setResults(null); changed(); searchRef.current?.focus();
  };
  const setQty = (id: number, q: number) => { setItems((xs) => xs.map((x) => (x.variantId === id ? { ...x, quantity: Math.max(1, Math.min(1000, q || 1)) } : x))); changed(); };

  const makeJob = async (kind: "print" | "test") => {
    if (!presetId || items.length === 0) return;
    setBusy(kind); setError(null);
    const res = await createPrintJobAction({
      purpose: kind === "test" ? "test" : purpose, presetId, deliveryId: purpose === "delivery" ? deliveryId : undefined,
      startPosition: start, items: items.map((i) => ({ variantId: i.variantId, quantity: i.quantity })),
    }).catch(() => null);
    setBusy(null);
    if (res?.ok && res.data) setJobId(res.data.jobId);
    else setError(res && !res.ok ? res.error : "Could not prepare the labels. Check the connection and try again.");
  };

  const sampleId = items[0]?.variantId;
  const previewUrl = jobId ? `/api/labels/${jobId}` : sampleId && presetId ? `/api/labels/sample?variant=${sampleId}&preset=${presetId}` : null;
  const paperName = (p: Preset) => (p.kind === "roll" ? "Label roll" : "A4 label sheet");

  return (
    <div className="flex flex-col gap-5">
      {pendingRelabel.length > 0 && (
        <section className="flex flex-col gap-3 rounded-2xl border border-warn/30 bg-warn-bg p-4 sm:flex-row sm:items-center" id="relabel" aria-labelledby="relabel-h">
          <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-2xl bg-white text-warn" aria-hidden><Tag className="size-5" /></span>
          <div className="min-w-0 flex-1">
            <h2 id="relabel-h" className="font-semibold">{pendingRelabel.length} shelf label{pendingRelabel.length === 1 ? "" : "s"} need replacing</h2>
            <p className="truncate text-sm text-muted">{pendingRelabel.slice(0, 3).map((r) => `${r.name} ${r.size} ${r.oldCents ? `${formatRand(r.oldCents)} → ` : ""}${formatRand(r.priceCents)}`).join(" · ")}{pendingRelabel.length > 3 ? " …" : ""}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => { pendingRelabel.forEach((r) => add({ ...r, quantity: 1 })); setPurpose("relabel"); }}><Plus className="size-4" aria-hidden /> Add to print list</Button>
            <Button variant="ghost" busy={busy === "relabel"} onClick={async () => { setBusy("relabel"); const ids = pendingRelabel.map((r) => r.variantId); const res = await acknowledgeRelabelAction(ids); setBusy(null); if (res?.ok) setRelabelDone((d) => [...d, ...ids]); }}>
              <Check className="size-4" aria-hidden /> Mark as relabelled</Button>
          </div>
        </section>
      )}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="flex flex-col gap-5">
          {/* 1 · What to print */}
          <section className="card p-5">
            <StepTitle n={1} title="What to print" hint="Scan an existing label or search by name, SKU or barcode." />
            <div className="relative">
              <label htmlFor="lsearch" className="sr-only">Scan or search plants</label>
              <ScanBarcode className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-deep" aria-hidden />
              <input id="lsearch" ref={searchRef} value={term} onChange={(e) => setTerm(e.target.value)} autoComplete="off"
                role="combobox" aria-expanded={!!results} aria-controls="lsearch-list" aria-activedescendant={results?.[active] ? `lres-${results[active].variantId}` : undefined}
                onKeyDown={(e) => {
                  if (!results?.length) return;
                  if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(results.length - 1, a + 1)); }
                  if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
                  if (e.key === "Enter") { e.preventDefault(); const exact = results.find((r) => r.barcode === term.trim()); add(exact ?? results[active]); }
                  if (e.key === "Escape") setResults(null);
                }}
                className="min-h-14 w-full rounded-2xl border border-field/70 bg-mist pl-12 pr-4 text-base placeholder:text-muted focus-visible:bg-surface" placeholder="Scan or search plants…" />
              {results && (
                <ul id="lsearch-list" role="listbox" className="absolute inset-x-0 top-full z-20 mt-2 max-h-80 overflow-y-auto rounded-2xl border border-line bg-surface p-1.5 shadow-[0_16px_40px_rgb(23_33_27/0.14)]">
                  {results.length === 0 && <li className="px-3 py-3 text-sm text-muted">Nothing matches “{term}”.</li>}
                  {results.map((r, i) => (
                    <li key={r.variantId} id={`lres-${r.variantId}`} role="option" aria-selected={i === active}>
                      <button type="button" onMouseEnter={() => setActive(i)} onClick={() => add(r)}
                        className={cx("flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left", i === active ? "bg-soft" : "hover:bg-mist")}>
                        <Barcode className="size-4 shrink-0 text-deep" aria-hidden />
                        <span className="min-w-0 flex-1"><span className="font-medium">{r.name}</span> <span className="text-muted">· {r.size}</span></span>
                        <span className="tabular text-sm font-semibold">{formatRand(r.priceCents)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {items.length === 0 ? (
              <div className="mt-4 flex flex-col items-center gap-2 rounded-2xl border border-dashed border-field/50 px-6 py-10 text-center">
                <span className="inline-flex size-12 items-center justify-center rounded-2xl bg-soft text-deep" aria-hidden><Barcode className="size-6" /></span>
                <p className="font-semibold">No labels yet</p>
                <p className="max-w-sm text-sm text-muted">Scan or search above. After receiving stock, “Print labels for this delivery” fills this list for you.</p>
              </div>
            ) : (
              <ul className="mt-4 flex flex-col gap-2">
                {items.map((it) => (
                  <li key={it.variantId} className="flex flex-wrap items-center gap-3 rounded-2xl border border-line p-3 sm:flex-nowrap">
                    <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-soft text-deep" aria-hidden><Tag className="size-4" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{it.name}</span>
                      <span className="block text-sm text-muted">{it.size} · <span className="tabular">{formatRand(it.priceCents)}</span>{it.barcode && <span className="font-mono"> · {it.barcode}</span>}</span>
                    </span>
                    <span className="flex items-center rounded-xl border border-field/50 p-0.5">
                      <button type="button" onClick={() => setQty(it.variantId, it.quantity - 1)} disabled={it.quantity <= 1} aria-label={`One fewer label for ${it.name}`}
                        className="inline-flex size-10 items-center justify-center rounded-lg hover:bg-soft disabled:opacity-40"><Minus className="size-4" aria-hidden /></button>
                      <label className="sr-only" htmlFor={`lq-${it.variantId}`}>Labels for {it.name} {it.size}</label>
                      <input id={`lq-${it.variantId}`} type="number" min={1} max={1000} value={it.quantity} inputMode="numeric"
                        onChange={(e) => setQty(it.variantId, Number(e.target.value))} className="tabular h-10 w-14 bg-transparent text-center text-lg font-bold" />
                      <button type="button" onClick={() => setQty(it.variantId, it.quantity + 1)} aria-label={`One more label for ${it.name}`}
                        className="inline-flex size-10 items-center justify-center rounded-lg hover:bg-soft"><Plus className="size-4" aria-hidden /></button>
                    </span>
                    <button type="button" onClick={() => { setItems((xs) => xs.filter((x) => x.variantId !== it.variantId)); changed(); }} aria-label={`Remove ${it.name} ${it.size}`}
                      className="inline-flex size-10 items-center justify-center rounded-full text-muted hover:bg-danger-bg hover:text-danger"><X className="size-4" aria-hidden /></button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* 2 · Label paper */}
          <section className="card p-5">
            <div className="flex items-start justify-between gap-3">
              <StepTitle n={2} title="Label paper" hint="Choose what is loaded in the printer." />
              {isOwner && <Link href="/admin/labels/presets" className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-deep hover:bg-soft"><Settings2 className="size-4" aria-hidden /> Sizes</Link>}
            </div>
            <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Label paper">
              {presets.map((p) => {
                const on = p.id === presetId;
                return (
                  <button key={p.id} type="button" role="radio" aria-checked={on} onClick={() => { setPresetId(p.id); setStart(1); changed(); }}
                    className={cx("relative flex flex-col gap-3 rounded-2xl border-2 p-4 text-left transition-colors", on ? "border-deep bg-soft/60" : "border-line hover:border-deep/30")}>
                    <span className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2 font-semibold">{p.kind === "roll" ? <Printer className="size-4 text-deep" aria-hidden /> : <LayoutGrid className="size-4 text-deep" aria-hidden />}{paperName(p)}</span>
                      <span className={cx("inline-flex size-5 items-center justify-center rounded-full border-2", on ? "border-deep bg-deep text-white" : "border-field")} aria-hidden>{on && <Check className="size-3" />}</span>
                    </span>
                    <PaperArt p={p} start={on ? start : 1} />
                    <span className="text-sm text-muted">{p.labelWidthMm} × {p.labelHeightMm} mm{p.kind === "sheet" ? ` · ${p.slots} per sheet` : " · thermal printer"}</span>
                  </button>
                );
              })}
            </div>
            {preset?.kind === "sheet" && (
              <div className="mt-4 grid gap-3 rounded-2xl bg-mist p-4 sm:grid-cols-[180px_1fr] sm:items-center">
                <PaperArt p={preset} start={start} onPick={(n) => { setStart(n); changed(); }} />
                <div>
                  <p className="font-semibold">Start at label {start}</p>
                  <p className="text-sm text-muted">{start > 1 ? `Labels 1–${start - 1} are skipped because they are already used.` : "Using a part-used sheet? Tap the first free label."}</p>
                  {start > 1 && <button type="button" className="mt-1 inline-flex min-h-11 items-center text-sm font-semibold text-deep underline" onClick={() => { setStart(1); changed(); }}>Start at the first label</button>}
                </div>
              </div>
            )}
          </section>

          {recent.length > 0 && (
            <details className="card group p-5">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 font-semibold">
                <span className="flex items-center gap-2"><RefreshCw className="size-4 text-deep" aria-hidden /> Reprint a recent job</span>
                <ChevronDown className="size-5 text-muted transition-transform group-open:rotate-180" aria-hidden />
              </summary>
              <ul className="mt-3 divide-y divide-line text-sm">
                {recent.map((j) => (
                  <li key={j.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span><span className="font-medium">{PURPOSE[j.purpose] ?? j.purpose}</span> · {j.count} label{j.count === 1 ? "" : "s"} <span className="text-muted">· {formatDateTime(j.at)} · {j.by}</span></span>
                    <Button variant="ghost" onClick={async () => {
                      const res = await createPrintJobAction({ purpose: "reprint", presetId: presetId!, items: j.items });
                      if (res?.ok && res.data) { setJobId(res.data.jobId); setPurpose("reprint"); } else if (res && !res.ok) setError(res.error);
                    }}>Reprint</Button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>

        {/* 3 · Print (sticky on desktop) */}
        <aside className="card flex flex-col gap-4 p-5 xl:sticky xl:top-20" aria-labelledby="print-h">
          <StepTitle n={3} title="Print" />
          <div className="rounded-2xl bg-[radial-gradient(circle_at_1px_1px,#d5ddd7_1px,transparent_0)] bg-[length:14px_14px] p-3 ring-1 ring-line" data-testid="label-preview-frame">
            {previewUrl ? <PdfPreview url={previewUrl} maxPages={jobId ? 3 : 1} />
              : <div className="flex aspect-[5/3] items-center justify-center rounded-xl text-sm text-muted">The label preview appears here</div>}
          </div>
          <dl className="grid grid-cols-3 gap-2 text-center">
            {[["Labels", count], [preset?.kind === "sheet" ? "Sheets" : "Pages", pages], ["Size", preset ? `${preset.labelWidthMm}×${preset.labelHeightMm}` : "—"]].map(([k, v]) => (
              <div key={String(k)} className="rounded-xl bg-mist px-2 py-2"><dt className="text-xs text-muted">{k}</dt><dd className="tabular font-semibold">{v}</dd></div>
            ))}
          </dl>
          {error && <Alert tone="error">{error}</Alert>}
          {jobId ? (
            <div className="flex flex-col gap-2">
              <p className="flex items-center gap-2 text-sm font-semibold text-deep"><Check className="size-4" aria-hidden /> Labels ready</p>
              <a className="inline-flex min-h-14 items-center justify-center gap-2 rounded-xl bg-primary text-lg font-semibold text-ink hover:bg-primary-hover" href={`/api/labels/${jobId}`} target="_blank" rel="noopener" data-testid="open-pdf">
                <Printer className="size-5" aria-hidden /> Open PDF to print</a>
              <div className="flex gap-2">
                <a className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-field/60 text-sm font-semibold hover:bg-soft" href={`/api/labels/${jobId}?download=1`}><Download className="size-4" aria-hidden /> Download</a>
                <button type="button" onClick={changed} className="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl text-sm font-semibold text-deep hover:bg-soft">Change labels</button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <Button size="xl" onClick={() => makeJob("print")} busy={busy === "print"} disabled={!items.length} data-testid="preview-labels">
                <Printer className="size-5" aria-hidden /> {count ? `Print ${count} label${count === 1 ? "" : "s"}` : "Print labels"}</Button>
              <Button variant="secondary" onClick={() => makeJob("test")} busy={busy === "test"} disabled={!items.length}><FlaskConical className="size-4" aria-hidden /> Print one test label</Button>
            </div>
          )}
          <div className="rounded-2xl bg-soft/60 p-3 text-sm">
            <button type="button" onClick={() => setShowTips((s) => !s)} aria-expanded={showTips} className="flex min-h-11 w-full items-center justify-between gap-2 font-semibold text-deep">
              <span className="flex items-center gap-2"><Search className="size-4" aria-hidden /> Print at actual size</span><ChevronDown className={cx("size-4 transition-transform", showTips && "rotate-180")} aria-hidden />
            </button>
            {showTips && (
              <ol className="mt-1 list-decimal space-y-1 pl-5 text-ink">
                <li>Open the PDF and press Ctrl + P.</li>
                <li>Choose the {preset?.kind === "sheet" ? "office printer" : "label printer"}.</li>
                <li>Set <strong>Scale 100% / Actual size</strong> — never “Fit to page”.</li>
                <li>{preset?.kind === "roll" ? `Paper size ${preset.labelWidthMm} × ${preset.labelHeightMm} mm in the printer driver.` : "Paper A4, no extra margins."}</li>
                <li>Print one test label and scan it at the POS.</li>
              </ol>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
