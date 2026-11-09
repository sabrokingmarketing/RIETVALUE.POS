import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { pageActor } from "@/server/session";
import { getVariant } from "@/server/catalog";
import { movementHistory } from "@/server/stock";
import { PageHeader } from "@/components/ui";
import { MovementTable } from "../movement-table";
import { AdjustButton } from "../adjust";

export const metadata: Metadata = { title: "Stock history" };

export default async function VariantStock({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await pageActor(["owner"], `/admin/stock/${id}`);
  const v = await getVariant(Number(id) || 0);
  if (!v) notFound();
  const rows = await movementHistory({ variantId: v.id, limit: 500 });
  return (
    <div className="mx-auto max-w-6xl">
      <Link href="/admin/stock" className="text-sm text-forest underline">← Stock</Link>
      <PageHeader title={`${v.common_name} — ${v.size_label}`} description={<>On hand: <strong className="tabular">{v.on_hand}</strong> · barcode {v.barcode} · SKU {v.sku}</>}
        actions={<AdjustButton variantId={v.id} label={`${v.common_name} — ${v.size_label}`} onHand={v.on_hand} />} />
      <MovementTable rows={rows} />
    </div>
  );
}
