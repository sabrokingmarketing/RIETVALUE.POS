"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Download, Printer, Search, Trash2, FlaskConical } from "lucide-react";
import { Alert, Badge, Button, Card, Field, cx, inputClass, buttonClass } from "@/components/ui";
import { formatRand } from "@/lib/money";
import { formatDateTime } from "@/lib/dates";
import { createPrintJobAction, searchVariantsAction } from "@/app/admin/actions";
import { acknowledgeRelabelAction } from "@/app/till/actions";
import { PdfPreview } from "./pdf-preview";

export type PrintItem = { variantId: number; name: string; size: string; priceCents: number; quantity: number; barcode: string };
type Preset = { id: number; name: string; kind: "roll" | "sheet"; slots: number; labelWidthMm: number; labelHeightMm: number; pageWidthMm: number; pageHeightMm: number; isDefault: boolean };
type Relabel = { variantId: number; name: string; size: string; priceCents: number; oldCents: number | null; barcode: string };
type Recent = { id: number; purpose: string; count: number; at: string; preset: string; by: string; items: { variantId: number; quantity: number }[] };

const PURPOSE: Record<string, string> = { delivery: "Delivery", batch: "Batch", reprint: "Reprint", test: "Test label", relabel: "Replacement" };

export function LabelPrinter({ presets, initialItems, initialPurpose, deliveryId, initialJobId, initialPresetId, relabel, recent, isOwner }: {
  presets: Preset[]; initialItems: PrintItem[]; initialPurpose: "batch" | "delivery"; deliveryId?: number; initialJobId?: number; initialPresetId?: number;
  relabel: Relabel[]; recent: Recent[]; isOwner: boolean;
}) {
  const [presetId, setPresetId] = useState(initialPresetId ?? presets.find((p) => p.isDefault)?.id ?? presets[0]?.id);
  const [items, setItems] = useState<PrintItem[]>(initialItems);
  const [purpose, setPurpose] = useState<"batch" | "delivery" | "relabel" | "reprint">(initialPurpose);
  const [start, setStart] = useState(1);
  const [outlines, setOutlines] = useState(false);
  const [jobId, setJobId] = useState<number | undefined>(initialJobId);
  const [busy, setBusy] = useState<null | "preview" | "test">(null);
  const [error, setError] = useState<string | null>(null);
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<PrintItem[] | null>(null);
  const [selectedRelabel, setSelectedRelabel] = useState<number[]>([]);
  const [relabelMsg, setRelabelMsg] = useState<string | null>(null);
  const preset = presets.find((p) => p.id === presetId);
  const count = items.reduce((s, i) => s + i.quantity, 0);

  useEffect(() => {
    const t = term.trim();
    if (t.length < 2) { setResults(null); return; }
    const h = setTimeout(async () => {
      const r = await searchVariantsAction(t).catch(() => []);
      setResults(r.map((v) => ({ variantId: v.id, name: v.common_name, size: v.size_label, priceCents: v.price_cents, quantity: 1, barcode: v.barcode })));
    }, 250);
    return () => clearTimeout(h);
  }, [term]);

  const changed = () => setJobId(undefined);
  const add = (it: PrintItem) => {
    setItems((xs) => (xs.some((x) => x.variantId === it.variantId) ? xs.map((x) => (x.variantId === it.variantId ? { ...x, quantity: x.quantity + it.quantity } : x)) : [...xs, it]));
    setTerm(""); setResults(null); changed();
  };

  const makeJob = async (kind: "preview" | "test") => {
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

  const pdfUrl = jobId ? `/api/labels/${jobId}${outlines ? "?outlines=1" : ""}` : null;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-6">
        <Card className="p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Label stock" htmlFor="preset" hint={isOwner ? <Link className="underline" href="/admin/labels/presets">Edit label sizes and sheet layout</Link> : undefined}>
              <select id="preset" value={presetId} onChange={(e) => { setPresetId(Number(e.target.value)); setStart(1); changed(); }} className={inputClass}>
                {presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            {preset?.kind === "sheet" && (
              <Field label="Start at label position" htmlFor="start" hint={`Skip used labels on a part-used sheet (1–${preset.slots}, left to right, top to bottom).`}>
                <input id="start" type="number" min={1} max={preset.slots} value={start} onChange={(e) => { setStart(Math.max(1, Math.min(preset.slots, Number(e.target.value) || 1))); changed(); }} className={inputClass} />
              </Field>
            )}
          </div>
          <label htmlFor="lsearch" className="mt-5 flex items-center gap-2 text-sm font-semibold"><Search className="size-4 text-forest" aria-hidden /> Add items</label>
          <input id="lsearch" value={term} onChange={(e) => setTerm(e.target.value)} className={cx(inputClass, "mt-1")} placeholder="Name, SKU or barcode" autoComplete="off" />
          {results && (
            <ul className="mt-2 divide-y divide-line rounded-lg border border-line">
              {results.length === 0 && <li className="p-3 text-sm text-muted">No match.</li>}
              {results.map((r) => (
                <li key={r.variantId}><button type="button" onClick={() => add(r)} className="flex min-h-11 w-full justify-between gap-2 px-3 py-2 text-left hover:bg-leaf">
                  <span>{r.name} — {r.size}</span><span className="tabular text-muted">{formatRand(r.priceCents)}</span></button></li>
              ))}
            </ul>
          )}
          {items.length === 0 ? <p className="mt-4 text-sm text-muted">No items yet. Search above, pick a delivery from Receive stock, or use the replacement list below.</p> : (
            <ul className="mt-4 divide-y divide-line">
              {items.map((it) => (
                <li key={it.variantId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="min-w-0"><span className="font-medium">{it.name}</span> — {it.size} <span className="tabular text-sm text-muted">{formatRand(it.priceCents)}</span></span>
                  <span className="flex items-center gap-2">
                    <label className="sr-only" htmlFor={`lq-${it.variantId}`}>Number of labels for {it.name} {it.size}</label>
                    <input id={`lq-${it.variantId}`} type="number" min={1} max={1000} value={it.quantity} className={cx(inputClass, "w-24 tabular")}
                      onChange={(e) => { const q = Math.max(1, Math.min(1000, Number(e.target.value) || 1)); setItems((xs) => xs.map((x) => (x.variantId === it.variantId ? { ...x, quantity: q } : x))); changed(); }} />
                    <button type="button" aria-label={`Remove ${it.name} ${it.size}`} className="inline-flex size-11 items-center justify-center rounded-lg text-danger hover:bg-danger-bg"
                      onClick={() => { setItems((xs) => xs.filter((x) => x.variantId !== it.variantId)); changed(); }}><Trash2 className="size-4" aria-hidden /></button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {error && <Alert tone="error" className="mt-4">{error}</Alert>}
          <div className="mt-5 flex flex-wrap gap-2">
            <Button onClick={() => makeJob("preview")} busy={busy === "preview"} disabled={!items.length} data-testid="preview-labels"><Printer className="size-4" aria-hidden /> Prepare {count} label{count === 1 ? "" : "s"}</Button>
            <Button variant="secondary" onClick={() => makeJob("test")} busy={busy === "test"} disabled={!items.length}><FlaskConical className="size-4" aria-hidden /> Print one test label</Button>
          </div>
        </Card>

        <Card className="p-5" id="relabel">
          <h2 className="font-semibold">Shelf labels to replace</h2>
          <p className="text-sm text-muted">These prices or names changed. Print new labels, stick them over the old ones, then mark them done.</p>
          {relabel.length === 0 ? <p className="mt-3 text-sm">Nothing to replace.</p> : (
            <>
              <ul className="mt-3 divide-y divide-line">
                {relabel.map((r) => (
                  <li key={r.variantId}>
                    <label className="flex min-h-11 items-center gap-3 py-1">
                      <input type="checkbox" className="size-5 accent-forest" checked={selectedRelabel.includes(r.variantId)}
                        onChange={(e) => setSelectedRelabel((s) => (e.target.checked ? [...s, r.variantId] : s.filter((x) => x !== r.variantId)))} />
                      <span className="flex-1">{r.name} — {r.size}</span>
                      <span className="tabular text-sm">{r.oldCents ? <><s className="text-muted">{formatRand(r.oldCents)}</s> → </> : null}<strong>{formatRand(r.priceCents)}</strong></span>
                    </label>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="secondary" disabled={!selectedRelabel.length} onClick={() => {
                  relabel.filter((r) => selectedRelabel.includes(r.variantId)).forEach((r) => add({ ...r, quantity: 1 }));
                  setPurpose("relabel");
                }}>Add selected to labels</Button>
                <Button variant="ghost" disabled={!selectedRelabel.length} onClick={async () => {
                  const res = await acknowledgeRelabelAction(selectedRelabel);
                  setRelabelMsg(res?.ok ? "Marked as relabelled." : res && !res.ok ? res.error : null);
                  setSelectedRelabel([]);
                }}>Mark selected as relabelled</Button>
              </div>
              {relabelMsg && <p className="mt-2 text-sm" role="status">{relabelMsg}</p>}
            </>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="font-semibold">Recent label jobs</h2>
          {recent.length === 0 ? <p className="mt-2 text-sm text-muted">No labels printed yet.</p> : (
            <ul className="mt-2 divide-y divide-line text-sm">
              {recent.map((j) => (
                <li key={j.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>{PURPOSE[j.purpose] ?? j.purpose} · {j.count} label{j.count === 1 ? "" : "s"} · {formatDateTime(j.at)} · {j.by}</span>
                  <Button variant="ghost" onClick={async () => {
                    const res = await createPrintJobAction({ purpose: "reprint", presetId: presetId!, items: j.items });
                    if (res?.ok && res.data) { setJobId(res.data.jobId); setPurpose("reprint"); } else if (res && !res.ok) setError(res.error);
                  }}>Reprint</Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="flex flex-col gap-4">
        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">Print preview {preset && <Badge>{preset.labelWidthMm} × {preset.labelHeightMm} mm</Badge>}</h2>
            <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="size-5 accent-forest" checked={outlines} onChange={(e) => setOutlines(e.target.checked)} /> Show label edges (for a test on plain paper)</label>
          </div>
          {pdfUrl ? (
            <>
              <div className="mt-3"><PdfPreview url={pdfUrl} /></div>
              <div className="mt-3 flex flex-wrap gap-2">
                <a className={buttonClass("primary")} href={pdfUrl} target="_blank" rel="noopener" data-testid="open-pdf"><Printer className="size-4" aria-hidden /> Open PDF to print</a>
                <a className={buttonClass("secondary")} href={`/api/labels/${jobId}?download=1`}><Download className="size-4" aria-hidden /> Download PDF</a>
              </div>
            </>
          ) : <p className="mt-3 text-sm text-muted">Choose items and press “Prepare labels”. The preview is the exact PDF that will print.</p>}
        </Card>
        <Alert tone="info" title="Print at actual size">
          <ol className="mt-1 list-decimal space-y-1 pl-5">
            <li>Open the PDF, then print (Ctrl + P).</li>
            <li>Choose the label printer{preset?.kind === "sheet" ? " (or office printer for A4 sheets)" : ""}.</li>
            <li>Set <strong>Scale: 100%</strong> / <strong>Actual size</strong>. Never “Fit to page”.</li>
            <li>{preset?.kind === "roll" ? `Paper size in the printer driver must be ${preset.labelWidthMm} × ${preset.labelHeightMm} mm.` : "Paper: A4, no extra margins."}</li>
            <li>Print one test label first and check it scans at the till.</li>
          </ol>
        </Alert>
      </div>
    </div>
  );
}
