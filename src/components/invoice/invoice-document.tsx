import { formatRand } from "@/lib/money";
import { invoiceBadge, invoiceTitle, PAID_METHODS, saDate, shortDate, type InvoiceStatusName, type PaidMethod } from "@/lib/invoice-format";
import { LogoMark } from "./logo-mark";
import { cx } from "@/components/ui";

export type DocBusiness = {
  business_name: string; legal_name: string; registration_no: string; vat_number: string; address_lines: string;
  phone: string; email: string; vat_rate_bp: number; thanks: string;
};
export type DocLine = { description: string; sku: string; quantity: number; unit_price_cents: number; line_total_cents: number };
export type DocInvoice = {
  invoice_no: string | null; status: InvoiceStatusName; source: "sale" | "manual"; receipt_no?: string | null;
  bill_name: string; bill_company: string; bill_email: string; bill_phone: string; bill_address: string; bill_vat_number: string;
  issue_date: string; due_date: string | null; reference: string; notes: string; payment_info: string;
  subtotal_cents: number; vat_cents: number; total_cents: number; vat_registered: boolean; business_snapshot: DocBusiness;
  paid_at: string | null; paid_method: "" | PaidMethod; void_reason: string; lines: DocLine[];
};

const toneClass = { green: "bg-soft text-deep", warn: "bg-warn-bg text-warn", danger: "bg-danger-bg text-danger", neutral: "bg-mist text-muted ring-1 ring-line" };

/** The invoice as a web page. Mirrors the PDF layout so the preview is what the customer receives. */
export function InvoiceDocument({ inv, logoFile, className }: { inv: DocInvoice; logoFile?: string; className?: string }) {
  const b = inv.business_snapshot;
  const badge = invoiceBadge(inv);
  const paid = inv.status === "paid";
  const label = "text-[10px] font-semibold uppercase tracking-[0.12em] text-muted";
  const due = paid && inv.paid_at ? shortDate(saDate(inv.paid_at)) : inv.due_date && inv.due_date !== inv.issue_date ? shortDate(inv.due_date) : "On receipt";
  return (
    <article className={cx("relative overflow-hidden rounded-2xl bg-white text-ink shadow-[0_1px_2px_rgb(23_33_27/0.06),0_12px_40px_rgb(23_33_27/0.08)] ring-1 ring-line", className)} data-testid="invoice-document">
      <div className="h-1.5 bg-deep" /><div className="h-1 bg-primary" />
      {(inv.status === "void" || inv.status === "draft") && (
        <span aria-hidden className={cx("pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 -rotate-[30deg] select-none text-[120px] font-bold opacity-[0.06] sm:text-[160px]", inv.status === "void" ? "text-danger" : "text-ink")}>
          {inv.status === "void" ? "VOID" : "DRAFT"}
        </span>
      )}
      <div className="px-5 pb-6 pt-6 sm:px-10 sm:pt-9">
        <header className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <h2 className="text-3xl font-bold tracking-wide sm:text-4xl">{invoiceTitle(inv).toUpperCase()}</h2>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm font-medium text-muted">
              <span className="tabular" data-testid="doc-number">{inv.invoice_no ?? "Number given when issued"}</span>
              <span className={cx("rounded-full px-2.5 py-0.5 text-xs font-semibold", toneClass[badge.tone])}>{badge.label}</span>
            </p>
          </div>
          <div className="ml-auto flex items-center gap-3">
            {!logoFile && <div className="text-right"><p className="text-lg font-bold leading-tight text-deep">{b.business_name}</p>{b.legal_name && b.legal_name !== b.business_name && <p className="text-xs text-muted">{b.legal_name}</p>}</div>}
            <LogoMark logoFile={logoFile} className={logoFile ? "h-20 max-w-56" : "size-20"} alt={b.business_name} />
          </div>
        </header>

        <div className="mt-8 grid border-y border-line text-[13px] leading-relaxed sm:grid-cols-3">
          <section className="py-4 sm:pr-5">
            <p className={label}>Bill from</p>
            <p className="mt-2 font-semibold">{b.business_name}</p>
            {b.address_lines && <p className="whitespace-pre-line text-muted">{b.address_lines}</p>}
            {b.phone && <p className="text-muted">Tel {b.phone}</p>}
            {b.email && <p className="text-muted">{b.email}</p>}
            {b.vat_number && <p className="font-medium">VAT no. {b.vat_number}</p>}
            {b.registration_no && <p className="text-muted">Reg. no. {b.registration_no}</p>}
          </section>
          <section className="border-t border-line py-4 sm:border-l sm:border-t-0 sm:px-5">
            <p className={label}>Bill to</p>
            <p className="mt-2 font-semibold" data-testid="doc-bill-name">{inv.bill_name || <span className="text-muted">Customer name</span>}</p>
            {inv.bill_company && <p className="font-medium">{inv.bill_company}</p>}
            {inv.bill_address && <p className="whitespace-pre-line text-muted">{inv.bill_address}</p>}
            {inv.bill_email && <p className="break-all text-muted">{inv.bill_email}</p>}
            {inv.bill_phone && <p className="text-muted">Tel {inv.bill_phone}</p>}
            {inv.bill_vat_number && <p className="font-medium">VAT no. {inv.bill_vat_number}</p>}
          </section>
          <section className="grid grid-cols-2 gap-3 border-t border-line py-4 sm:block sm:space-y-3 sm:border-l sm:border-t-0 sm:pl-5">
            <div><p className={label}>Issue date</p><p className="font-semibold">{shortDate(inv.issue_date)}</p></div>
            <div><p className={label}>{paid ? "Paid on" : "Due date"}</p><p className="font-semibold">{due}</p></div>
            {inv.reference && <div><p className={label}>Reference</p><p className="font-semibold">{inv.reference}</p></div>}
          </section>
        </div>

        <div className="mt-7 overflow-x-auto">
          <table className="w-full min-w-[460px] text-[13px]">
            <thead>
              <tr className="bg-soft text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-deep">
                <th className="rounded-l-lg px-3 py-2.5">Description</th><th className="px-3 py-2.5 text-right">Price</th>
                <th className="px-3 py-2.5 text-center">Qty</th><th className="rounded-r-lg px-3 py-2.5 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {inv.lines.length === 0 && <tr><td colSpan={4} className="border-b border-line px-3 py-6 text-center text-muted">Line items appear here</td></tr>}
              {inv.lines.map((l, i) => (
                <tr key={i} className="border-b border-line align-top">
                  <td className="px-3 py-3"><span className="font-medium">{l.description || <span className="text-muted">Description</span>}</span>{l.sku && <span className="block text-[11px] text-muted">{l.sku}</span>}</td>
                  <td className="tabular px-3 py-3 text-right">{formatRand(l.unit_price_cents)}</td>
                  <td className="tabular px-3 py-3 text-center">{l.quantity}</td>
                  <td className="tabular px-3 py-3 text-right font-semibold">{formatRand(l.line_total_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-6 flex flex-col-reverse gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-sm space-y-4 text-[13px]">
            {inv.payment_info && <div><p className={label}>Payment information</p><p className="mt-1 whitespace-pre-line">{inv.payment_info}</p></div>}
            {inv.notes && <div><p className={label}>Notes</p><p className="mt-1 whitespace-pre-line">{inv.notes}</p></div>}
            {!inv.payment_info && !inv.notes && inv.source === "sale" && <div><p className={label}>Payment</p><p className="mt-1">Paid in full at the till{inv.receipt_no ? ` (receipt ${inv.receipt_no})` : ""}.</p></div>}
          </div>
          <dl className="w-full text-[13px] sm:w-72">
            {inv.vat_registered ? <>
              <div className="flex justify-between border-b border-line px-3 py-2"><dt className="text-muted">Subtotal (excl. VAT)</dt><dd className="tabular font-medium">{formatRand(inv.subtotal_cents)}</dd></div>
              <div className="flex justify-between border-b border-line px-3 py-2"><dt className="text-muted">VAT {b.vat_rate_bp / 100}%</dt><dd className="tabular font-medium">{formatRand(inv.vat_cents)}</dd></div>
            </> : <div className="flex justify-between border-b border-line px-3 py-2"><dt className="text-muted">Subtotal</dt><dd className="tabular font-medium">{formatRand(inv.total_cents)}</dd></div>}
            <div className={cx("mt-2 flex items-center justify-between rounded-xl px-3 py-3", paid ? "bg-mist" : "bg-deep text-white")}>
              <dt className="font-semibold">{paid ? "Total" : "Total due"}</dt><dd className="tabular text-xl font-bold" data-testid="doc-total">{formatRand(inv.total_cents)}</dd>
            </div>
            {paid && <>
              <p className="px-3 pt-2 text-xs text-deep">Paid{inv.paid_method ? ` · ${PAID_METHODS[inv.paid_method]}` : ""}{inv.paid_at ? ` · ${shortDate(saDate(inv.paid_at))}` : ""}</p>
              <div className="mt-2 flex justify-between rounded-xl bg-soft px-3 py-2.5 font-semibold text-deep"><dt>Balance due</dt><dd className="tabular">{formatRand(0)}</dd></div>
            </>}
          </dl>
        </div>
        {inv.status === "void" && inv.void_reason && <p className="mt-6 text-sm font-medium text-danger">Voided: {inv.void_reason}</p>}
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-2 border-t-[3px] border-primary bg-deep px-5 py-4 text-white sm:px-10">
        <p className="font-semibold">{b.thanks || "Thank you for your business!"}</p>
        <p className="text-xs text-soft-strong">{[b.phone && `Tel ${b.phone}`, b.email].filter(Boolean).join(" · ")}</p>
      </footer>
    </article>
  );
}
