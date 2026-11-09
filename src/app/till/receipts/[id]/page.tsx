import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Printer } from "lucide-react";
import { pageActor } from "@/server/session";
import { getReceipt } from "@/server/receipts";
import { ReceiptView } from "@/components/receipt/receipt-view";
import { Card, buttonClass } from "@/components/ui";
import { ReturnPanel } from "./return-panel";

export const metadata: Metadata = { title: "Receipt" };

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await pageActor(["owner", "cashier"], `/till/receipts/${id}`);
  const r = await getReceipt(actor, id);
  if (!r) notFound();
  const returnable = r.lines.some((l) => l.quantity > l.returned_qty);
  return (
    <div className="mx-auto grid w-full max-w-5xl gap-6 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div>
        <Link href="/till/receipts" className="text-sm text-forest underline">← All receipts</Link>
        <h1 className="mt-2 text-2xl font-semibold">Receipt <span className="font-mono">{r.receipt_no}</span></h1>
        <div className="mt-4 flex flex-wrap gap-2">
          <a className={buttonClass("primary")} href={`/print/receipt/${r.id}?size=80mm&auto=1&copy=1`} target="_blank" rel="noopener" data-testid="reprint-80"><Printer className="size-4" aria-hidden /> Reprint receipt (80 mm)</a>
          <a className={buttonClass("secondary")} href={`/print/receipt/${r.id}?size=a4&auto=1&copy=1`} target="_blank" rel="noopener">A4 copy</a>
        </div>
        <Card className="mt-4 flex justify-center overflow-x-auto p-4"><ReceiptView r={r} size="80mm" /></Card>
      </div>
      <div>
        <h2 className="text-xl font-semibold">Return items</h2>
        {r.returns.length > 0 && (
          <ul className="mt-2 space-y-1 text-sm">
            {r.returns.map((x) => (
              <li key={x.id}><a className="text-forest underline" href={`/print/return/${x.id}`} target="_blank" rel="noopener">{x.return_no}</a> — {x.reason} ({x.refund_method})</li>
            ))}
          </ul>
        )}
        {returnable ? <ReturnPanel receipt={r} isOwner={actor.role === "owner"} /> : <p className="mt-2 text-sm text-muted">Everything on this receipt has already been returned.</p>}
      </div>
    </div>
  );
}
