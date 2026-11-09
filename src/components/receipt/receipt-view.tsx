import type { Receipt } from "@/server/receipts";
import { formatRand } from "@/lib/money";
import { formatDateTime } from "@/lib/dates";
import { cx } from "@/components/ui";

/** The printable receipt. Everything shown comes from the immutable sale snapshot. */
export function ReceiptView({ r, size = "80mm", reprint }: { r: Receipt; size?: "80mm" | "a4"; reprint?: boolean }) {
  const b = r.business_snapshot;
  const narrow = size === "80mm";
  const title = r.vat_registered ? "TAX INVOICE" : "RECEIPT";
  return (
    <article className={cx("bg-white text-black", narrow ? "w-[72mm] text-[11px] leading-snug" : "mx-auto w-full max-w-[180mm] text-sm")} data-testid="receipt">
      <header className={cx("text-center", narrow ? "mb-2" : "mb-6")}>
        <p className={cx("font-bold", narrow ? "text-sm" : "text-xl")}>{b.business_name}</p>
        {b.legal_name && b.legal_name !== b.business_name && <p>{b.legal_name}</p>}
        {b.address_lines && <p className="whitespace-pre-line">{b.address_lines}</p>}
        {b.phone && <p>Tel {b.phone}</p>}
        {b.vat_number && <p>VAT no. {b.vat_number}</p>}
        {b.registration_no && <p>Reg. no. {b.registration_no}</p>}
        <p className={cx("mt-2 font-bold tracking-wide", !narrow && "text-lg")}>{title}{reprint ? " — COPY" : ""}</p>
      </header>
      <dl className="grid grid-cols-2 gap-x-2">
        <dt>Receipt</dt><dd className="text-right font-semibold">{r.receipt_no}</dd>
        <dt>Date</dt><dd className="text-right">{formatDateTime(r.created_at)}</dd>
        <dt>Served by</dt><dd className="text-right">{r.cashier_name}</dd>
      </dl>
      <hr className="my-2 border-dashed border-black" />
      <table className="w-full">
        <thead className={narrow ? "sr-only" : ""}>
          <tr className="text-left"><th>Item</th><th className="text-right">Qty</th><th className="text-right">Price</th><th className="text-right">Total</th></tr>
        </thead>
        <tbody>
          {r.lines.map((l) => (
            <tr key={l.id} className="align-top">
              <td className="py-0.5 pr-1">{l.description}{narrow && <span className="block text-[10px]">{l.quantity} × {formatRand(l.unit_price_cents)}</span>}<span className="block text-[10px] text-neutral-600">{l.sku}</span></td>
              {!narrow && <td className="tabular text-right">{l.quantity}</td>}
              {!narrow && <td className="tabular text-right">{formatRand(l.unit_price_cents)}</td>}
              <td className="tabular py-0.5 text-right">{formatRand(l.line_total_cents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <hr className="my-2 border-dashed border-black" />
      <dl className="tabular grid grid-cols-2 gap-x-2">
        <dt className={cx("font-bold", narrow ? "text-sm" : "text-lg")}>TOTAL</dt>
        <dd className={cx("text-right font-bold", narrow ? "text-sm" : "text-lg")} data-testid="receipt-total">{formatRand(r.total_cents)}</dd>
        {r.vat_registered && <><dt>VAT included ({(b.vat_rate_bp / 100).toFixed(0)}%)</dt><dd className="text-right">{formatRand(r.vat_cents)}</dd>
          <dt>Total excl. VAT</dt><dd className="text-right">{formatRand(r.total_cents - r.vat_cents)}</dd></>}
        {r.payment.method === "cash" ? (
          <><dt>Cash</dt><dd className="text-right">{formatRand(r.payment.tendered_cents ?? 0)}</dd>
            <dt>Change</dt><dd className="text-right" data-testid="receipt-change">{formatRand(r.payment.change_cents ?? 0)}</dd></>
        ) : (
          <><dt>Card (terminal)</dt><dd className="text-right">{formatRand(r.payment.amount_cents)}</dd>
            {r.payment.reference && <><dt>Card ref.</dt><dd className="text-right">{r.payment.reference}</dd></>}</>
        )}
      </dl>
      {r.returns.length > 0 && (
        <>
          <hr className="my-2 border-dashed border-black" />
          <p className="font-semibold">Returns against this receipt</p>
          {r.returns.map((x) => <p key={x.id} className="tabular flex justify-between"><span>{x.return_no} · {formatDateTime(x.created_at)}</span><span>−{formatRand(x.total_cents)}</span></p>)}
        </>
      )}
      {b.receipt_footer && <p className="mt-3 text-center whitespace-pre-line">{b.receipt_footer}</p>}
    </article>
  );
}
