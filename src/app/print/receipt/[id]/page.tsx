import { notFound } from "next/navigation";
import { pageActor } from "@/server/session";
import { getReceipt } from "@/server/receipts";
import { ReceiptView } from "@/components/receipt/receipt-view";
import { PrintControls } from "../../auto-print";

export const dynamic = "force-dynamic";

export default async function PrintReceipt({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ size?: string; auto?: string; copy?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const actor = await pageActor(["owner", "cashier"], `/print/receipt/${id}`);
  const r = await getReceipt(actor, id);
  if (!r) notFound();
  const size = sp.size === "a4" ? "a4" : "80mm";
  return (
    <>
      <style>{size === "80mm" ? "@page { size: 80mm auto; margin: 3mm 4mm; }" : "@page { size: A4; margin: 15mm; }"}</style>
      <PrintControls auto={sp.auto === "1"} backHref={`/till/receipts/${id}`} />
      <div className={size === "80mm" ? "p-2" : "p-6"}><ReceiptView r={r} size={size} reprint={sp.copy === "1"} /></div>
    </>
  );
}
