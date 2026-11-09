"use client";
import { useEffect, useId, useState } from "react";
import { CheckCircle2, ChevronDown, FileText, Loader2, Mail, MailWarning, RotateCcw, Send } from "lucide-react";
import { Dialog } from "@/components/dialog";
import { Alert, Button, cx, inputClass } from "@/components/ui";
import type { Customer } from "@/server/invoices";

export type SaleInvoiceRequest = { email: string; name: string; company?: string; vatNumber?: string; address?: string; phone?: string };
export type SaleInvoiceState =
  | { status: "sending"; to: string }
  | { status: "sent" | "not_configured" | "failed"; to: string; invoiceId: string | null; invoiceNo: string | null; error?: string };

export const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim());

/** Creates (or re-uses) the invoice for a completed sale and e-mails it. Never throws. */
export async function sendSaleInvoice(saleId: string, req: SaleInvoiceRequest): Promise<SaleInvoiceState> {
  const to = req.email.trim();
  try {
    const res = await fetch("/api/invoices/from-sale", {
      method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
      body: JSON.stringify({ saleId, email: to, name: req.name.trim(), company: req.company ?? "", vatNumber: req.vatNumber ?? "", address: req.address ?? "", phone: req.phone ?? "" }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) return { status: "failed", to, invoiceId: null, invoiceNo: null, error: body?.error?.message ?? "The invoice could not be made." };
    return { status: body.email.status, to, invoiceId: body.invoiceId, invoiceNo: body.invoiceNo, error: body.email.error };
  } catch {
    return { status: "failed", to, invoiceId: null, invoiceNo: null, error: "No connection. The sale is safe — try sending the invoice again." };
  }
}

function useCustomerSuggestions(term: string) {
  const [list, setList] = useState<Customer[]>([]);
  useEffect(() => {
    const t = term.trim();
    if (t.length < 3) { setList([]); return; }
    let live = true;
    const h = setTimeout(() => {
      fetch(`/api/customers?q=${encodeURIComponent(t)}`, { cache: "no-store" }).then((r) => r.json()).then((d) => live && setList(d.customers ?? [])).catch(() => {});
    }, 200);
    return () => { live = false; clearTimeout(h); };
  }, [term]);
  return list;
}

/** Customer fields with saved-customer suggestions. */
function CustomerFields({ value, onChange, compact }: { value: SaleInvoiceRequest; onChange: (v: SaleInvoiceRequest) => void; compact?: boolean }) {
  const id = useId();
  const [focus, setFocus] = useState(false);
  const [more, setMore] = useState(false);
  const sugg = useCustomerSuggestions(focus ? value.email || value.name : "");
  const show = focus && sugg.length > 0 && !sugg.some((c) => c.email === value.email.trim().toLowerCase());
  return (
    <div className="flex flex-col gap-3">
      <div className="relative grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-e`} className="text-sm font-medium">Customer e-mail</label>
          <input id={`${id}-e`} type="email" inputMode="email" autoComplete="off" value={value.email} onFocus={() => setFocus(true)} onBlur={() => setTimeout(() => setFocus(false), 150)}
            onChange={(e) => onChange({ ...value, email: e.target.value })} className={inputClass} placeholder="name@example.com" data-testid="invoice-email" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-n`} className="text-sm font-medium">Name <span className="font-normal text-muted">(optional)</span></label>
          <input id={`${id}-n`} autoComplete="off" value={value.name} onFocus={() => setFocus(true)} onBlur={() => setTimeout(() => setFocus(false), 150)}
            onChange={(e) => onChange({ ...value, name: e.target.value })} className={inputClass} placeholder="As it should appear on the invoice" data-testid="invoice-name" />
        </div>
        {show && (
          <ul className="absolute inset-x-0 top-full z-20 mt-1 rounded-2xl border border-line bg-surface p-1.5 shadow-xl" role="listbox" aria-label="Saved customers">
            {sugg.slice(0, 4).map((c) => (
              <li key={c.id} role="option" aria-selected={false}>
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { onChange({ ...value, email: c.email, name: c.name, company: c.company, vatNumber: c.vat_number, address: c.address, phone: c.phone }); setFocus(false); }}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-soft">
                  <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-soft text-xs font-semibold text-deep">{c.name.slice(0, 1).toUpperCase()}</span>
                  <span className="min-w-0 text-sm"><span className="block truncate font-medium">{c.name}{c.company && <span className="text-muted"> · {c.company}</span>}</span><span className="block truncate text-xs text-muted">{c.email}</span></span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {!compact && (
        <>
          <button type="button" onClick={() => setMore(!more)} aria-expanded={more} className="inline-flex min-h-9 items-center gap-1.5 self-start text-sm font-semibold text-deep">
            <ChevronDown className={cx("size-4 transition-transform", more && "rotate-180")} aria-hidden /> Company and VAT number (for business customers)
          </button>
          {more && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1"><label htmlFor={`${id}-c`} className="text-sm font-medium">Company</label>
                <input id={`${id}-c`} value={value.company ?? ""} onChange={(e) => onChange({ ...value, company: e.target.value })} className={inputClass} maxLength={120} /></div>
              <div className="flex flex-col gap-1"><label htmlFor={`${id}-v`} className="text-sm font-medium">Their VAT number</label>
                <input id={`${id}-v`} value={value.vatNumber ?? ""} onChange={(e) => onChange({ ...value, vatNumber: e.target.value })} className={inputClass} maxLength={20} /></div>
              <div className="flex flex-col gap-1 sm:col-span-2"><label htmlFor={`${id}-a`} className="text-sm font-medium">Address</label>
                <textarea id={`${id}-a`} rows={2} value={value.address ?? ""} onChange={(e) => onChange({ ...value, address: e.target.value })} className={cx(inputClass, "py-2")} maxLength={400} /></div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** In the payment dialog: "E-mail an invoice" switch with the customer's details. */
export function InvoiceOptIn({ on, setOn, value, onChange }: { on: boolean; setOn: (b: boolean) => void; value: SaleInvoiceRequest; onChange: (v: SaleInvoiceRequest) => void }) {
  return (
    <div className={cx("rounded-2xl border p-3 transition-colors", on ? "border-deep/40 bg-soft/40" : "border-line")}>
      <label className="flex min-h-11 cursor-pointer items-center gap-3">
        <span className={cx("inline-flex size-9 shrink-0 items-center justify-center rounded-xl", on ? "bg-deep text-white" : "bg-mist text-deep")}><FileText className="size-4" aria-hidden /></span>
        <span className="flex-1"><span className="block text-sm font-semibold">E-mail an invoice</span><span className="block text-xs text-muted">Saved to Invoices and sent with the PDF once the sale completes</span></span>
        <input type="checkbox" role="switch" checked={on} onChange={(e) => setOn(e.target.checked)} className="peer sr-only" data-testid="invoice-toggle" />
        <span aria-hidden className={cx("relative h-7 w-12 shrink-0 rounded-full transition-colors peer-focus-visible:outline peer-focus-visible:outline-3 peer-focus-visible:outline-deep", on ? "bg-deep" : "bg-field/50")}>
          <span className={cx("absolute top-1 size-5 rounded-full bg-white shadow transition-all", on ? "left-6" : "left-1")} />
        </span>
      </label>
      {on && <div className="mt-3"><CustomerFields value={value} onChange={onChange} compact /></div>}
      {on && value.email && !isEmail(value.email) && <p className="mt-2 text-xs text-danger">Check the e-mail address.</p>}
    </div>
  );
}

/** After the sale: shows what happened to the invoice, with resend / send-now. */
export function SaleInvoiceStatus({ state, onOpen }: { state: SaleInvoiceState | null; onOpen: () => void }) {
  if (!state) {
    return (
      <button type="button" onClick={onOpen} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-deep/30 bg-surface px-4 text-sm font-semibold text-deep hover:bg-soft" data-testid="sale-invoice-open">
        <Mail className="size-4" aria-hidden /> E-mail invoice
      </button>
    );
  }
  const ok = state.status === "sent";
  const icon = state.status === "sending" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : ok ? <CheckCircle2 className="size-4" aria-hidden /> : <MailWarning className="size-4" aria-hidden />;
  const text = state.status === "sending" ? `Sending invoice to ${state.to}…`
    : ok ? `Invoice ${state.invoiceNo} e-mailed to ${state.to}`
    : state.status === "not_configured" ? `Invoice ${state.invoiceNo} saved — e-mail isn't set up, so it wasn't sent`
    : state.error ?? "The invoice was not sent";
  return (
    <div className={cx("flex w-full flex-wrap items-center gap-2 rounded-xl px-3 py-2 text-sm", ok ? "bg-white text-deep" : state.status === "sending" ? "bg-white text-muted" : "bg-warn-bg text-warn")} role="status" data-testid="sale-invoice-status">
      {icon}<span className="font-medium">{text}</span>
      {state.status !== "sending" && (
        <span className="ml-auto flex gap-2">
          {"invoiceId" in state && state.invoiceId && <a href={`/api/invoices/${state.invoiceId}/pdf`} target="_blank" rel="noopener" className="inline-flex min-h-9 items-center rounded-lg px-2 font-semibold underline">View PDF</a>}
          <button type="button" onClick={onOpen} className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 font-semibold underline"><RotateCcw className="size-3.5" aria-hidden /> {ok ? "Send to another address" : "Try again"}</button>
        </span>
      )}
    </div>
  );
}

/** Dialog to e-mail the invoice for a completed sale (from the POS or the receipt page). */
export function SaleInvoiceDialog({ open, onClose, saleId, initial, onDone, receiptNo }: {
  open: boolean; onClose: () => void; saleId: string; initial?: SaleInvoiceRequest; receiptNo?: string; onDone: (s: SaleInvoiceState) => void;
}) {
  const [value, setValue] = useState<SaleInvoiceRequest>(initial ?? { email: "", name: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (open) { setValue(initial ?? { email: "", name: "" }); setErr(null); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = async () => {
    if (!isEmail(value.email)) { setErr("Enter the customer's e-mail address."); return; }
    setBusy(true); setErr(null);
    const r = await sendSaleInvoice(saleId, value);
    setBusy(false);
    if (r.status === "failed" && !("invoiceId" in r && r.invoiceId)) { setErr(r.error ?? "Could not send."); return; }
    onDone(r); onClose();
  };
  return (
    <Dialog open={open} onClose={() => !busy && onClose()} locked={busy} title="E-mail an invoice" icon={<Send className="size-5" />}
      description={receiptNo ? `For receipt ${receiptNo}. Saved to Invoices and sent with the PDF.` : "Saved to Invoices and sent with the PDF."}
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button onClick={submit} busy={busy} data-testid="sale-invoice-send"><Send className="size-4" aria-hidden /> Send invoice</Button></>}>
      <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <CustomerFields value={value} onChange={setValue} />
        {err && <Alert tone="error" className="mt-3">{err}</Alert>}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
