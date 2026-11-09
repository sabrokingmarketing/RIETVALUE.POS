"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search, Trash2, Tags, PackageCheck } from "lucide-react";
import type { Category, VariantRow } from "@/server/catalog";
import { Alert, Button, Card, Field, cx, inputClass } from "@/components/ui";
import { formatRand, parseRandToCents, centsToInput } from "@/lib/money";
import { addSizeQuickAction, createPrintJobAction, quickCreateAction, receiveDeliveryAction, searchVariantsAction } from "../actions";

type Line = { v: VariantRow; quantity: string; price: string };
type Saved = { deliveryId: number; deliveryNo: string; replayed: boolean; lines: { variantId: number; quantity: number; onHand: number; priceChanged: boolean }[] };

export function ReceiveScreen({ categories, defaultPresetId }: { categories: Category[]; defaultPresetId?: number }) {
  const router = useRouter();
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [lines, setLines] = useState<Line[]>([]);
  const [supplier, setSupplier] = useState("");
  const [note, setNote] = useState("");
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<VariantRow[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [printing, setPrinting] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [newSizeFor, setNewSizeFor] = useState<VariantRow | null>(null);
  const qtyRefs = useRef<Record<number, HTMLInputElement | null>>({});
  const focusVariant = useRef<number | null>(null);

  useEffect(() => {
    if (focusVariant.current !== null) { qtyRefs.current[focusVariant.current]?.focus(); focusVariant.current = null; }
  }, [lines]);

  const runSearch = async (t: string) => {
    setSearching(true);
    try { setResults(await searchVariantsAction(t)); } catch { setError("Search failed — check the connection."); }
    finally { setSearching(false); }
  };
  useEffect(() => {
    const t = term.trim();
    if (t.length < 2) { setResults(null); return; }
    const h = setTimeout(() => runSearch(t), 250);
    return () => clearTimeout(h);
  }, [term]);

  const add = (v: VariantRow) => {
    setSaved(null);
    if (lines.some((l) => l.v.id === v.id)) { qtyRefs.current[v.id]?.focus(); return; }
    focusVariant.current = v.id;
    setLines((ls) => [...ls, { v, quantity: "", price: centsToInput(v.price_cents) }]);
    setTerm(""); setResults(null);
  };

  const onSearchEnter = async () => {
    const t = term.trim();
    if (!t) return;
    const r = await searchVariantsAction(t);
    const exact = r.find((v) => v.barcode === t || v.sku === t.toUpperCase());
    if (exact) add(exact); else if (r.length === 1) add(r[0]); else setResults(r);
  };

  const problems = lines.map((l) => {
    const q = Number(l.quantity);
    const p = parseRandToCents(l.price);
    if (!Number.isInteger(q) || q < 1) return "Enter how many arrived";
    if (p === null || p <= 0) return "Enter the selling price";
    return null;
  });
  const canSave = lines.length > 0 && problems.every((p) => p === null);
  const units = lines.reduce((s, l) => s + (Number(l.quantity) || 0), 0);

  const save = async () => {
    setSaving(true); setError(null);
    try {
      const res = await receiveDeliveryAction({
        idempotencyKey: key, supplier, note,
        lines: lines.map((l) => ({ variantId: l.v.id, quantity: Number(l.quantity), priceCents: parseRandToCents(l.price)! })),
      });
      if (res?.ok && res.data) setSaved(res.data);
      else if (res && !res.ok) setError(res.error);
    } catch {
      setError("No answer from the server. Press Save again — it is safe and will not count the stock twice.");
    } finally { setSaving(false); }
  };

  const printDelivery = async () => {
    if (!saved || !defaultPresetId) return;
    setPrinting(true); setError(null);
    const res = await createPrintJobAction({ purpose: "delivery", presetId: defaultPresetId, deliveryId: saved.deliveryId,
      items: saved.lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })) }).catch(() => null);
    setPrinting(false);
    if (res?.ok && res.data) router.push(`/admin/labels?job=${res.data.jobId}`);
    else setError(res && !res.ok ? res.error : "Could not prepare labels. Your stock is saved — try Print labels again.");
  };

  const reset = () => { setKey(crypto.randomUUID()); setLines([]); setSupplier(""); setNote(""); setSaved(null); setError(null); };

  if (saved) {
    return (
      <Card className="border-2 border-forest p-6" data-testid="delivery-saved">
        <p className="flex items-center gap-2 text-lg font-semibold text-forest"><PackageCheck className="size-6" aria-hidden /> Stock saved as {saved.deliveryNo}</p>
        <ul className="mt-3 space-y-1 text-sm">
          {saved.lines.map((l) => {
            const line = lines.find((x) => x.v.id === l.variantId);
            return <li key={l.variantId}><strong>{l.quantity} ×</strong> {line?.v.common_name} — {line?.v.size_label} <span className="text-muted">(now {l.onHand} in stock)</span>{l.priceChanged && <span className="text-warn"> · price updated, shelf labels flagged</span>}</li>;
          })}
        </ul>
        {error && <Alert tone="error" className="mt-3">{error}</Alert>}
        <div className="mt-5 flex flex-wrap gap-2">
          <Button size="lg" onClick={printDelivery} busy={printing} data-testid="print-delivery-labels"><Tags className="size-5" aria-hidden /> Print labels for this delivery ({units})</Button>
          <Button size="lg" variant="secondary" onClick={reset}>Receive another delivery</Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Card className="p-5">
        <label htmlFor="find" className="flex items-center gap-2 font-semibold"><Search className="size-5 text-forest" aria-hidden /> Find the plant</label>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <input id="find" value={term} onChange={(e) => setTerm(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onSearchEnter(); } }}
            className={inputClass} placeholder="Name, SKU, or scan an existing label" autoComplete="off" />
          <Button variant="secondary" onClick={() => { setShowNew((s) => !s); setNewSizeFor(null); }} aria-expanded={showNew}><Plus className="size-4" aria-hidden /> New plant</Button>
        </div>
        <div aria-live="polite">
          {searching && <p className="mt-2 text-sm text-muted">Searching…</p>}
          {results && !searching && results.length === 0 && <p className="mt-2 text-sm text-muted">No match. Use “New plant” to create it.</p>}
          {results && results.length > 0 && (
            <ul className="mt-3 divide-y divide-line rounded-lg border border-line">
              {results.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <span><strong>{v.common_name}</strong> — {v.size_label} <span className="tabular text-sm text-muted">{formatRand(v.price_cents)} · {v.on_hand} in stock</span></span>
                  <span className="flex gap-1">
                    <Button variant="ghost" onClick={() => { setNewSizeFor(v); setShowNew(false); }}>New size</Button>
                    <Button variant="secondary" onClick={() => add(v)}>Add to delivery</Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        {showNew && <QuickCreate categories={categories} onCreated={(v) => { setShowNew(false); add(v); }} />}
        {newSizeFor && <QuickSize base={newSizeFor} onCreated={(v) => { setNewSizeFor(null); add(v); }} onCancel={() => setNewSizeFor(null)} />}
      </Card>

      <Card className="p-5">
        <h2 className="font-semibold">This delivery</h2>
        {lines.length === 0 ? <p className="mt-2 text-sm text-muted">Nothing added yet. Find each plant above and add it.</p> : (
          <ul className="mt-3 divide-y divide-line">
            {lines.map((l, i) => {
              const newPrice = parseRandToCents(l.price);
              const changed = newPrice !== null && newPrice !== l.v.price_cents;
              return (
                <li key={l.v.id} className="grid gap-3 py-3 sm:grid-cols-[1fr_8rem_9rem_auto] sm:items-end" data-testid="delivery-line">
                  <div>
                    <p className="font-semibold">{l.v.common_name} — {l.v.size_label}</p>
                    <p className="text-xs text-muted">Barcode {l.v.barcode} · now {l.v.on_hand} in stock</p>
                  </div>
                  <Field label="Quantity" htmlFor={`q-${l.v.id}`}>
                    <input id={`q-${l.v.id}`} ref={(el) => { qtyRefs.current[l.v.id] = el; }} type="number" min={1} max={10000} inputMode="numeric" value={l.quantity}
                      onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} className={cx(inputClass, "tabular text-lg font-semibold")} />
                  </Field>
                  <Field label="Selling price (R)" htmlFor={`p-${l.v.id}`}>
                    <input id={`p-${l.v.id}`} inputMode="decimal" value={l.price}
                      onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))} className={cx(inputClass, "tabular text-lg font-semibold")} />
                  </Field>
                  <button type="button" className="inline-flex min-h-11 items-center gap-1 rounded-lg px-3 text-sm text-danger hover:bg-danger-bg" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label={`Remove ${l.v.common_name} ${l.v.size_label}`}>
                    <Trash2 className="size-4" aria-hidden /> Remove
                  </button>
                  {changed && <p className="text-sm text-warn sm:col-span-4">Price will change from {formatRand(l.v.price_cents)} to {formatRand(newPrice!)}. Shelf labels already on this size will be flagged for replacement.</p>}
                  {problems[i] && l.quantity !== "" && <p className="text-sm text-danger sm:col-span-4">{problems[i]}</p>}
                </li>
              );
            })}
          </ul>
        )}
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Supplier (optional)" htmlFor="supplier"><input id="supplier" value={supplier} onChange={(e) => setSupplier(e.target.value)} maxLength={120} className={inputClass} /></Field>
          <Field label="Note (optional)" htmlFor="note"><input id="note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className={inputClass} /></Field>
        </div>
        {error && <Alert tone="error" className="mt-4">{error}</Alert>}
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button size="lg" onClick={save} busy={saving} disabled={!canSave} data-testid="save-delivery">Save receipt of stock{units ? ` (${units} units)` : ""}</Button>
          <p className="text-sm text-muted">Saving adds the stock. You can print labels straight after.</p>
        </div>
      </Card>
    </div>
  );
}

function QuickCreate({ categories, onCreated }: { categories: Category[]; onCreated: (v: VariantRow) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form className="mt-4 rounded-lg border border-forest/40 bg-leaf/40 p-4" onSubmit={async (e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      setBusy(true); setError(null);
      const res = await quickCreateAction({ commonName: String(f.get("commonName")), botanicalName: String(f.get("botanicalName")), categoryId: Number(f.get("categoryId")),
        sizeLabel: String(f.get("sizeLabel")), price: String(f.get("price")) }).catch(() => null);
      setBusy(false);
      if (res?.ok && res.data) onCreated(res.data); else setError(res && !res.ok ? res.error : "Could not save. Check the connection.");
    }}>
      <h3 className="mb-3 font-semibold">New plant</h3>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Common name" htmlFor="nc"><input id="nc" name="commonName" required maxLength={80} className={inputClass} /></Field>
        <Field label="Botanical name (optional)" htmlFor="nb"><input id="nb" name="botanicalName" maxLength={120} className={cx(inputClass, "italic")} /></Field>
        <Field label="Category" htmlFor="ncat">
          <select id="ncat" name="categoryId" required defaultValue="" className={inputClass}><option value="" disabled>Choose…</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        </Field>
        <Field label="Pot or pack size" htmlFor="ns"><input id="ns" name="sizeLabel" required maxLength={40} placeholder="15 cm pot" className={inputClass} /></Field>
        <Field label="Selling price (R)" htmlFor="np"><input id="np" name="price" required inputMode="decimal" placeholder="89.90" className={cx(inputClass, "tabular")} /></Field>
      </div>
      {error && <Alert tone="error" className="mt-3">{error}</Alert>}
      <Button type="submit" className="mt-3" busy={busy}>Create and add to delivery</Button>
    </form>
  );
}

function QuickSize({ base, onCreated, onCancel }: { base: VariantRow; onCreated: (v: VariantRow) => void; onCancel: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form className="mt-4 rounded-lg border border-forest/40 bg-leaf/40 p-4" onSubmit={async (e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      setBusy(true); setError(null);
      const res = await addSizeQuickAction({ productId: base.product_id, sizeLabel: String(f.get("sizeLabel")), price: String(f.get("price")) }).catch(() => null);
      setBusy(false);
      if (res?.ok && res.data) onCreated(res.data); else setError(res && !res.ok ? res.error : "Could not save. Check the connection.");
    }}>
      <h3 className="mb-3 font-semibold">New size of {base.common_name}</h3>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Pot or pack size" htmlFor="qs"><input id="qs" name="sizeLabel" required maxLength={40} placeholder="20 cm pot" className={inputClass} /></Field>
        <Field label="Selling price (R)" htmlFor="qp"><input id="qp" name="price" required inputMode="decimal" className={cx(inputClass, "tabular")} /></Field>
      </div>
      {error && <Alert tone="error" className="mt-3">{error}</Alert>}
      <div className="mt-3 flex gap-2"><Button type="submit" busy={busy}>Create and add</Button><Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button></div>
    </form>
  );
}
