"use client";
import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Building2, CalendarDays, ChevronDown, Eye, Loader2, Minus, NotebookPen, PackagePlus, PenLine, Plus, Search, Send, Sprout, Trash2, UserRound } from "lucide-react";
import { Alert, Button, cx, inputClass } from "@/components/ui";
import { centsToInput, formatRand, parseRandToCents, vatIncluded } from "@/lib/money";
import { addDays, shortDate } from "@/lib/invoice-format";
import type { TillItem } from "@/lib/till-types";
import type { Customer, ManualInvoiceInput } from "@/server/invoices";
import { InvoiceDocument, type DocBusiness } from "./invoice-document";
import { saveInvoiceAction } from "@/app/admin/invoices/actions";

type Line = { key: string; variantId: number | null; description: string; sku: string; quantity: string; price: string };
export type EditorInitial = {
  id: string | null;
  billTo: { name: string; company: string; email: string; phone: string; address: string; vatNumber: string };
  issueDate: string; dueDate: string; reference: string; notes: string; paymentInfo: string;
  lines: { variantId: number | null; description: string; sku: string; quantity: number; unitPriceCents: number }[];
};

let seq = 0;
const newKey = () => `l${++seq}`;
const toLine = (l: EditorInitial["lines"][number]): Line => ({ key: newKey(), variantId: l.variantId, description: l.description, sku: l.sku, quantity: String(l.quantity), price: centsToInput(l.unitPriceCents) });
const blankLine = (): Line => ({ key: newKey(), variantId: null, description: "", sku: "", quantity: "1", price: "" });

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

function Step({ n, icon, title, sub, children, right }: { n: number; icon: React.ReactNode; title: string; sub?: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="card p-5 sm:p-6" aria-labelledby={`step-${n}`}>
      <div className="mb-4 flex items-start gap-3">
        <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-soft text-deep" aria-hidden>{icon}</span>
        <div className="min-w-0 flex-1"><h2 id={`step-${n}`} className="font-semibold">{title}</h2>{sub && <p className="text-sm text-muted">{sub}</p>}</div>
        {right}
      </div>
      {children}
    </section>
  );
}

const lbl = "text-sm font-medium";

export function InvoiceEditor({ initial, business, vatRegistered, vatRateBp, termsDays, logoFile, today }: {
  initial: EditorInitial; business: DocBusiness; vatRegistered: boolean; vatRateBp: number; termsDays: number; logoFile: string; today: string;
}) {
  const router = useRouter();
  const uid = useId();
  const [bill, setBill] = useState(initial.billTo);
  const [issueDate, setIssueDate] = useState(initial.issueDate);
  const [dueDate, setDueDate] = useState(initial.dueDate);
  const [reference, setReference] = useState(initial.reference);
  const [notes, setNotes] = useState(initial.notes);
  const [paymentInfo, setPaymentInfo] = useState(initial.paymentInfo);
  const [lines, setLines] = useState<Line[]>(initial.lines.length ? initial.lines.map(toLine) : [blankLine()]);
  const [moreBill, setMoreBill] = useState(!!(initial.billTo.address || initial.billTo.vatNumber || initial.billTo.phone));
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"draft" | "issue" | "send" | null>(null);
  const [pending, start] = useTransition();
  const [tab, setTab] = useState<"edit" | "preview">("edit");

  // Customer book search
  const [custQ, setCustQ] = useState("");
  const [custOpen, setCustOpen] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const dq = useDebounced(custQ, 200);
  useEffect(() => {
    if (dq.trim().length < 2) { setCustomers([]); return; }
    let live = true;
    fetch(`/api/customers?q=${encodeURIComponent(dq)}`, { cache: "no-store" }).then((r) => r.json()).then((d) => { if (live) setCustomers(d.customers ?? []); }).catch(() => {});
    return () => { live = false; };
  }, [dq]);
  const pickCustomer = (c: Customer) => {
    setBill({ name: c.name, company: c.company, email: c.email, phone: c.phone, address: c.address, vatNumber: c.vat_number });
    if (c.address || c.vat_number || c.phone) setMoreBill(true);
    setCustQ(""); setCustOpen(false);
  };

  // Catalogue search
  const [itemQ, setItemQ] = useState("");
  const [items, setItems] = useState<TillItem[]>([]);
  const [itemBusy, setItemBusy] = useState(false);
  const diq = useDebounced(itemQ, 200);
  const itemRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (diq.trim().length < 2) { setItems([]); return; }
    let live = true; setItemBusy(true);
    fetch(`/api/till/search?q=${encodeURIComponent(diq)}&limit=8`, { cache: "no-store" }).then((r) => r.json()).then((d) => { if (live) setItems(d.items ?? []); })
      .catch(() => {}).finally(() => live && setItemBusy(false));
    return () => { live = false; };
  }, [diq]);
  const addItem = (it: TillItem) => {
    setLines((ls) => {
      const existing = ls.find((l) => l.variantId === it.variantId);
      if (existing) return ls.map((l) => (l === existing ? { ...l, quantity: String((parseInt(l.quantity) || 0) + 1) } : l));
      const fresh: Line = { key: newKey(), variantId: it.variantId, description: `${it.name} — ${it.size}`, sku: it.sku, quantity: "1", price: centsToInput(it.priceCents) };
      const onlyBlank = ls.length === 1 && !ls[0].description && !ls[0].price;
      return onlyBlank ? [fresh] : [...ls, fresh];
    });
    setItemQ(""); itemRef.current?.focus();
  };
  const update = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const remove = (key: string) => setLines((ls) => (ls.length === 1 ? [blankLine()] : ls.filter((l) => l.key !== key)));
  const step = (key: string, d: number) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, quantity: String(Math.max(1, Math.min(99999, (parseInt(l.quantity) || 0) + d))) } : l)));

  const rate = vatRegistered ? vatRateBp : 0;
  const parsed = useMemo(() => lines.map((l) => {
    const qty = /^\d+$/.test(l.quantity) ? parseInt(l.quantity) : NaN;
    const unit = l.price.trim() === "" ? null : parseRandToCents(l.price);
    const total = Number.isFinite(qty) && unit !== null ? qty * unit : 0;
    return { ...l, qty, unit, total, vat: vatIncluded(total, rate) };
  }), [lines, rate]);
  const total = parsed.reduce((s, l) => s + l.total, 0);
  const vat = parsed.reduce((s, l) => s + l.vat, 0);
  const filled = parsed.filter((l) => l.description.trim() || l.unit !== null);

  const terms = [["On receipt", 0], ["7 days", 7], ["14 days", 14], ["30 days", 30]] as const;
  const dueChoice = !dueDate || dueDate === issueDate ? 0 : terms.find(([, d]) => addDays(issueDate, d) === dueDate)?.[1];

  const payload = (): ManualInvoiceInput => ({
    billTo: bill, issueDate, dueDate, reference, notes, paymentInfo,
    lines: filled.map((l) => ({ variantId: l.variantId, description: l.description, sku: l.sku, quantity: Number.isFinite(l.qty) ? l.qty : 0, unitPriceCents: l.unit ?? -1 })),
  });
  const check = (): string | null => {
    if (!bill.name.trim()) return "Enter the customer's name.";
    if (!filled.length) return "Add at least one item.";
    const bad = filled.find((l) => !l.description.trim());
    if (bad) return "Every line needs a description.";
    if (filled.some((l) => !Number.isFinite(l.qty) || l.qty < 1)) return "Quantities must be whole numbers of 1 or more.";
    if (filled.some((l) => l.unit === null)) return "Enter each price in rand, e.g. 89.90";
    return null;
  };
  const save = (m: "draft" | "issue" | "send") => {
    const problem = check();
    if (problem) { setError(problem); return; }
    if (m === "send" && !bill.email) { setError("Add the customer's e-mail address to send the invoice."); return; }
    setError(null); setMode(m);
    start(async () => {
      const r = await saveInvoiceAction(initial.id, payload(), m);
      if (!r || !r.ok) { setError(r?.error ?? "Could not save."); setMode(null); return; }
      const q = new URLSearchParams({ done: m, ...(r.data?.email ? { mail: r.data.email.status } : {}) });
      router.push(`/admin/invoices/${r.data!.id}?${q}`);
      router.refresh();
    });
  };

  const preview = (
    <InvoiceDocument logoFile={logoFile} inv={{
      invoice_no: null, status: "draft", source: "manual", bill_name: bill.name, bill_company: bill.company, bill_email: bill.email, bill_phone: bill.phone,
      bill_address: bill.address, bill_vat_number: bill.vatNumber, issue_date: issueDate, due_date: dueDate || null, reference, notes, payment_info: paymentInfo,
      subtotal_cents: total - vat, vat_cents: vat, total_cents: total, vat_registered: vatRegistered, business_snapshot: business, paid_at: null, paid_method: "", void_reason: "",
      lines: parsed.filter((l) => l.description || l.unit !== null).map((l) => ({ description: l.description, sku: l.sku, quantity: Number.isFinite(l.qty) ? l.qty : 0, unit_price_cents: l.unit ?? 0, line_total_cents: l.total })),
    }} />
  );

  return (
    <div className="pb-28">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/admin/invoices" className="inline-flex size-11 items-center justify-center rounded-xl border border-line bg-surface hover:bg-soft" aria-label="Back to invoices"><ArrowLeft className="size-5" aria-hidden /></Link>
          <div><h1 className="text-2xl font-semibold tracking-tight">{initial.id ? "Edit draft invoice" : "New invoice"}</h1>
            <p className="text-sm text-muted"><span className="xl:hidden">Fill in the details — tap Preview to see the invoice.</span><span className="hidden xl:inline">Fill in the left side — the invoice on the right updates as you type.</span></p></div>
        </div>
        <div className="flex rounded-xl bg-surface p-1 ring-1 ring-line xl:hidden" role="tablist" aria-label="View">
          {(["edit", "preview"] as const).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
              className={cx("inline-flex min-h-10 items-center gap-2 rounded-lg px-4 text-sm font-semibold", tab === t ? "bg-deep text-white" : "text-muted")}>
              {t === "edit" ? <PenLine className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}{t === "edit" ? "Edit" : "Preview"}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        <div className={cx("flex flex-col gap-5", tab === "preview" && "hidden xl:flex")}>
          <Step n={1} icon={<UserRound className="size-5" />} title="Who is it for?" sub="Pick a saved customer or type new details. New customers are saved for next time.">
            <div className="relative mb-4">
              <label htmlFor={`${uid}-cq`} className="sr-only">Find a saved customer</label>
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-deep" aria-hidden />
              <input id={`${uid}-cq`} value={custQ} onChange={(e) => { setCustQ(e.target.value); setCustOpen(true); }} onFocus={() => setCustOpen(true)} onBlur={() => setTimeout(() => setCustOpen(false), 150)}
                placeholder="Search saved customers by name, e-mail or phone" autoComplete="off" role="combobox" aria-expanded={custOpen && customers.length > 0} aria-controls={`${uid}-cl`}
                className={cx(inputClass, "min-h-12 rounded-2xl bg-mist pl-10")} />
              {custOpen && customers.length > 0 && (
                <ul id={`${uid}-cl`} role="listbox" className="absolute inset-x-0 top-full z-20 mt-2 max-h-72 overflow-auto rounded-2xl border border-line bg-surface p-1.5 shadow-xl">
                  {customers.map((c) => (
                    <li key={c.id} role="option" aria-selected={false}>
                      <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pickCustomer(c)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-soft">
                        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-soft text-sm font-semibold text-deep">{c.name.slice(0, 1).toUpperCase()}</span>
                        <span className="min-w-0"><span className="block truncate font-medium">{c.name}{c.company && <span className="text-muted"> · {c.company}</span>}</span><span className="block truncate text-xs text-muted">{c.email || c.phone || "No e-mail"}</span></span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1"><label className={lbl} htmlFor={`${uid}-n`}>Customer name <span className="text-danger" aria-hidden>*</span></label>
                <input id={`${uid}-n`} className={inputClass} value={bill.name} onChange={(e) => setBill({ ...bill, name: e.target.value })} autoComplete="off" maxLength={120} data-testid="bill-name" /></div>
              <div className="flex flex-col gap-1"><label className={lbl} htmlFor={`${uid}-e`}>E-mail</label>
                <input id={`${uid}-e`} type="email" className={inputClass} value={bill.email} onChange={(e) => setBill({ ...bill, email: e.target.value })} autoComplete="off" maxLength={200} placeholder="Where the invoice is sent" data-testid="bill-email" /></div>
              <div className="flex flex-col gap-1 sm:col-span-2"><label className={lbl} htmlFor={`${uid}-co`}>Company <span className="font-normal text-muted">(optional)</span></label>
                <input id={`${uid}-co`} className={inputClass} value={bill.company} onChange={(e) => setBill({ ...bill, company: e.target.value })} maxLength={120} /></div>
            </div>
            <button type="button" onClick={() => setMoreBill(!moreBill)} aria-expanded={moreBill} className="mt-3 inline-flex min-h-10 items-center gap-1.5 text-sm font-semibold text-deep">
              <ChevronDown className={cx("size-4 transition-transform", moreBill && "rotate-180")} aria-hidden /> Address, phone and VAT number
            </button>
            {moreBill && (
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1 sm:row-span-2"><label className={lbl} htmlFor={`${uid}-a`}>Address</label>
                  <textarea id={`${uid}-a`} rows={4} className={cx(inputClass, "py-2")} value={bill.address} onChange={(e) => setBill({ ...bill, address: e.target.value })} maxLength={400} /></div>
                <div className="flex flex-col gap-1"><label className={lbl} htmlFor={`${uid}-p`}>Phone</label>
                  <input id={`${uid}-p`} type="tel" className={inputClass} value={bill.phone} onChange={(e) => setBill({ ...bill, phone: e.target.value })} maxLength={40} /></div>
                <div className="flex flex-col gap-1"><label className={lbl} htmlFor={`${uid}-v`}>Customer VAT number</label>
                  <input id={`${uid}-v`} className={inputClass} value={bill.vatNumber} onChange={(e) => setBill({ ...bill, vatNumber: e.target.value })} maxLength={20} /></div>
              </div>
            )}
          </Step>

          <Step n={2} icon={<CalendarDays className="size-5" />} title="Dates and reference">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1"><label className={lbl} htmlFor={`${uid}-d`}>Invoice date</label>
                <input id={`${uid}-d`} type="date" className={inputClass} value={issueDate} onChange={(e) => { const v = e.target.value || today; const d = dueChoice ?? null; setIssueDate(v); if (d !== null) setDueDate(d ? addDays(v, d) : ""); }} /></div>
              <div className="flex flex-col gap-1"><label className={lbl} htmlFor={`${uid}-r`}>Reference <span className="font-normal text-muted">(e.g. their order no.)</span></label>
                <input id={`${uid}-r`} className={inputClass} value={reference} onChange={(e) => setReference(e.target.value)} maxLength={80} /></div>
            </div>
            <fieldset className="mt-4">
              <legend className={lbl}>Payment due</legend>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {terms.map(([label, d]) => (
                  <button key={label} type="button" aria-pressed={dueChoice === d} onClick={() => setDueDate(d ? addDays(issueDate, d) : "")}
                    className={cx("inline-flex min-h-10 items-center rounded-full border px-4 text-sm font-medium", dueChoice === d ? "border-deep bg-deep text-white" : "border-line bg-surface hover:bg-soft")}>{label}</button>
                ))}
                <label className="inline-flex min-h-10 items-center gap-2 rounded-full border border-line bg-surface pl-4 pr-1 text-sm">
                  <span className={dueChoice === undefined ? "font-semibold text-deep" : "text-muted"}>Pick a date</span>
                  <input type="date" min={issueDate} value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="min-h-8 rounded-full bg-mist px-2 text-sm" aria-label="Due date" />
                </label>
              </div>
              <p className="mt-2 text-xs text-muted">{dueDate && dueDate !== issueDate ? `Due on ${shortDate(dueDate)}` : "Due on receipt"} · your default is {termsDays ? `${termsDays} days` : "on receipt"} (Settings → Invoices).</p>
            </fieldset>
          </Step>

          <Step n={3} icon={<Sprout className="size-5" />} title="What are you charging for?" sub="Add plants from your catalogue, or type any item or service. Prices include VAT, like your shelf prices."
            right={<span className="tabular hidden rounded-full bg-soft px-3 py-1 text-sm font-semibold text-deep sm:inline">{formatRand(total)}</span>}>
            <div className="relative mb-4">
              <label htmlFor={`${uid}-iq`} className="sr-only">Add from catalogue</label>
              <PackagePlus className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-deep" aria-hidden />
              <input id={`${uid}-iq`} ref={itemRef} value={itemQ} onChange={(e) => setItemQ(e.target.value)} placeholder="Add from catalogue — type a plant, SKU or barcode" autoComplete="off"
                className={cx(inputClass, "min-h-12 rounded-2xl bg-mist pl-10")} data-testid="catalogue-search"
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (items[0]) addItem(items[0]); } if (e.key === "Escape") setItemQ(""); }} />
              {itemBusy && <Loader2 className="absolute right-3.5 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted" aria-hidden />}
              {itemQ.trim().length >= 2 && !itemBusy && (
                <ul className="absolute inset-x-0 top-full z-20 mt-2 max-h-80 overflow-auto rounded-2xl border border-line bg-surface p-1.5 shadow-xl" role="listbox">
                  {items.length === 0 && <li className="px-3 py-3 text-sm text-muted">Nothing in the catalogue matches. Use “Add a custom line” below.</li>}
                  {items.map((it) => (
                    <li key={it.variantId} role="option" aria-selected={false}>
                      <button type="button" onClick={() => addItem(it)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-soft">
                        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-soft text-deep"><Sprout className="size-4" aria-hidden /></span>
                        <span className="min-w-0 flex-1"><span className="block truncate font-medium">{it.name}</span><span className="block truncate text-xs text-muted">{it.size} · {it.sku}</span></span>
                        <span className="tabular font-semibold">{formatRand(it.priceCents)}</span>
                        <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-ink">Add</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <ol className="flex flex-col gap-2" data-testid="invoice-lines">
              {parsed.map((l, i) => (
                <li key={l.key} className="rounded-2xl border border-line bg-surface p-3">
                  <div className="flex min-w-0 flex-col gap-1">
                    <label className="flex items-center gap-2 text-xs font-medium text-muted" htmlFor={`${uid}-ld${i}`}>Item {i + 1}{l.variantId && <span className="rounded bg-soft px-1.5 py-px text-[10px] font-semibold tracking-wide text-deep">CATALOGUE</span>}</label>
                    <input id={`${uid}-ld${i}`} className={inputClass} value={l.description} onChange={(e) => update(l.key, { description: e.target.value })} placeholder="e.g. Garden service — 2 hours" maxLength={200} data-testid={`line-desc-${i}`} />
                  </div>
                  <div className="mt-3 flex flex-wrap items-end gap-3">
                    <div className="flex flex-col gap-1">
                      <span className="text-xs font-medium text-muted" id={`${uid}-lq${i}`}>Qty</span>
                      <div className="flex h-11 items-center rounded-xl border border-field" role="group" aria-labelledby={`${uid}-lq${i}`}>
                        <button type="button" onClick={() => step(l.key, -1)} className="inline-flex size-10 items-center justify-center rounded-l-xl hover:bg-soft" aria-label="One fewer"><Minus className="size-4" aria-hidden /></button>
                        <input inputMode="numeric" value={l.quantity} onChange={(e) => update(l.key, { quantity: e.target.value.replace(/[^\d]/g, "").slice(0, 5) })} className="tabular h-full w-12 bg-transparent text-center font-semibold" aria-label={`Quantity for item ${i + 1}`} data-testid={`line-qty-${i}`} />
                        <button type="button" onClick={() => step(l.key, 1)} className="inline-flex size-10 items-center justify-center rounded-r-xl hover:bg-soft" aria-label="One more"><Plus className="size-4" aria-hidden /></button>
                      </div>
                    </div>
                    <div className="flex w-32 flex-col gap-1">
                      <label className="text-xs font-medium text-muted" htmlFor={`${uid}-lp${i}`}>Price each (R)</label>
                      <input id={`${uid}-lp${i}`} inputMode="decimal" className={cx(inputClass, "tabular text-right", l.price && l.unit === null && "border-danger")} value={l.price} onChange={(e) => update(l.key, { price: e.target.value })} placeholder="0.00" aria-invalid={!!l.price && l.unit === null} data-testid={`line-price-${i}`} />
                    </div>
                    <div className="ml-auto flex items-center gap-1">
                      <span className="flex flex-col items-end"><span className="text-xs text-muted">Line total</span><span className="tabular min-w-24 text-right text-lg font-semibold">{formatRand(l.total)}</span></span>
                      <button type="button" onClick={() => remove(l.key)} className="inline-flex size-11 items-center justify-center rounded-xl text-muted hover:bg-danger-bg hover:text-danger" aria-label={`Remove item ${i + 1}`}><Trash2 className="size-4" aria-hidden /></button>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
            <button type="button" onClick={() => setLines((ls) => [...ls, blankLine()])} className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-field/70 text-sm font-semibold text-deep hover:bg-soft" data-testid="add-line">
              <Plus className="size-4" aria-hidden /> Add a custom line
            </button>
            <dl className="mt-4 space-y-1 rounded-2xl bg-mist p-4 text-sm">
              {vatRegistered && <>
                <div className="flex justify-between"><dt className="text-muted">Subtotal (excl. VAT)</dt><dd className="tabular">{formatRand(total - vat)}</dd></div>
                <div className="flex justify-between"><dt className="text-muted">VAT {vatRateBp / 100}% (included)</dt><dd className="tabular">{formatRand(vat)}</dd></div>
              </>}
              <div className="flex justify-between pt-1 text-base font-semibold"><dt>Total</dt><dd className="tabular" data-testid="editor-total">{formatRand(total)}</dd></div>
            </dl>
          </Step>

          <Step n={4} icon={<NotebookPen className="size-5" />} title="Payment details and notes" sub="Printed at the bottom of the invoice.">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1"><label className={lbl} htmlFor={`${uid}-pi`}>How to pay</label>
                <textarea id={`${uid}-pi`} rows={4} className={cx(inputClass, "py-2")} value={paymentInfo} onChange={(e) => setPaymentInfo(e.target.value)} maxLength={600} placeholder="Bank, account number, branch code, reference" /></div>
              <div className="flex flex-col gap-1"><label className={lbl} htmlFor={`${uid}-no`}>Notes for the customer</label>
                <textarea id={`${uid}-no`} rows={4} className={cx(inputClass, "py-2")} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} placeholder="e.g. Delivery on Saturday morning" /></div>
            </div>
          </Step>
        </div>

        <div className={cx("xl:block", tab === "edit" && "hidden")}>
          <div className="xl:sticky xl:top-20">
            <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted"><Eye className="size-4" aria-hidden /> Live preview</p>
            {preview}
          </div>
        </div>
      </div>

      {/* Sticky action bar */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur md:left-[92px] lg:left-64">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-2.5 sm:flex-row sm:items-center sm:gap-3 sm:px-6 sm:py-3 lg:px-8" style={{ paddingBottom: "max(0.625rem, env(safe-area-inset-bottom))" }}>
          <div className="flex items-center justify-between gap-3 sm:mr-auto sm:block sm:min-w-0">
            <div className="min-w-0">
              <p className="truncate text-xs text-muted">{bill.name ? <>For <strong className="text-ink">{bill.company || bill.name}</strong>{bill.email && <span className="hidden sm:inline"> · {bill.email}</span>}</> : "No customer yet"}</p>
              <p className="tabular text-xl font-bold">{formatRand(total)}</p>
            </div>
            <span className="sm:hidden"><Button variant="ghost" onClick={() => save("draft")} busy={pending && mode === "draft"} disabled={pending}>Save draft</Button></span>
          </div>
          {error && <Alert tone="error" className="sm:max-w-sm">{error}</Alert>}
          <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
            <span className="hidden sm:contents"><Button variant="ghost" onClick={() => save("draft")} busy={pending && mode === "draft"} disabled={pending} data-testid="save-draft">Save draft</Button></span>
            <Button variant="secondary" onClick={() => save("issue")} busy={pending && mode === "issue"} disabled={pending} data-testid="issue-invoice"><Building2 className="size-4" aria-hidden /> Issue</Button>
            <Button onClick={() => save("send")} busy={pending && mode === "send"} disabled={pending || !bill.email} title={!bill.email ? "Add the customer's e-mail first" : undefined} data-testid="issue-send" className="sm:min-h-12 sm:px-5 sm:text-base">
              <Send className="size-4" aria-hidden /> Issue &amp; e-mail
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
