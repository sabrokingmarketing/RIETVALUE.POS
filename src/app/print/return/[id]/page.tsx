import { notFound } from "next/navigation";
import { pageActor } from "@/server/session";
import { getReturn } from "@/server/returns";
import { formatRand } from "@/lib/money";
import { formatDateTime } from "@/lib/dates";
import { PrintControls } from "../../auto-print";

export const dynamic = "force-dynamic";

export default async function PrintReturn({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ auto?: string }> }) {
  const { id } = await params;
  const actor = await pageActor(["owner", "cashier"], `/print/return/${id}`);
  const n = Number(id);
  const r = Number.isInteger(n) && n > 0 ? await getReturn(actor, n) : null;
  if (!r) notFound();
  const b = r.business_snapshot;
  return (
    <>
      <style>{"@page { size: 80mm auto; margin: 3mm 4mm; }"}</style>
      <PrintControls auto={(await searchParams).auto === "1"} backHref={`/till/receipts/${r.sale_id}`} />
      <article className="w-[72mm] p-2 text-[11px] leading-snug text-black">
        <p className="text-center text-sm font-bold">{b.business_name}</p>
        {b.vat_number && <p className="text-center">VAT no. {b.vat_number}</p>}
        <p className="mt-2 text-center font-bold">{b.vat_number ? "CREDIT NOTE" : "RETURN SLIP"}</p>
        <dl className="mt-2 grid grid-cols-2">
          <dt>Return</dt><dd className="text-right font-semibold">{r.return_no}</dd>
          <dt>Original receipt</dt><dd className="text-right">{r.receipt_no}</dd>
          <dt>Date</dt><dd className="text-right">{formatDateTime(r.created_at)}</dd>
          <dt>Processed by</dt><dd className="text-right">{r.processed_by_name}</dd>
          <dt>Authorised by</dt><dd className="text-right">{r.authorised_by_name}</dd>
        </dl>
        <hr className="my-2 border-dashed border-black" />
        {r.lines.map((l, i) => (
          <p key={i} className="tabular flex justify-between gap-2"><span>{l.quantity} × {l.description} ({l.condition})</span><span>−{formatRand(l.amount_cents)}</span></p>
        ))}
        <hr className="my-2 border-dashed border-black" />
        <p className="tabular flex justify-between text-sm font-bold"><span>REFUND</span><span>{formatRand(r.total_cents)}</span></p>
        {r.vat_cents > 0 && <p className="tabular flex justify-between"><span>VAT included</span><span>{formatRand(r.vat_cents)}</span></p>}
        <p className="flex justify-between"><span>Refund by</span><span>{r.refund_method}{r.refund_reference ? ` (${r.refund_reference})` : ""}</span></p>
        <p className="mt-2">Reason: {r.reason}</p>
      </article>
    </>
  );
}
