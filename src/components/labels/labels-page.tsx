import { listPresets, recentPrintJobs } from "@/server/labels";
import { getVariantsByIds, relabelQueue } from "@/server/catalog";
import { getDelivery } from "@/server/stock";
import { q1 } from "@/server/db";
import { PageHeader } from "@/components/ui";
import { LabelPrinter, type PrintItem } from "./label-printer";

/** Shared by the owner workspace and the cashier's label page. */
export async function LabelsPage({ isOwner, searchParams }: { isOwner: boolean; searchParams: { variant?: string; delivery?: string; job?: string } }) {
  const [presets, relabel, recent] = await Promise.all([listPresets(), relabelQueue(), recentPrintJobs(10)]);
  let initial: PrintItem[] = [];
  let purpose: "batch" | "delivery" = "batch";
  let deliveryId: number | undefined;
  let jobId: number | undefined;
  let jobPresetId: number | undefined;

  const ids = (s?: string) => (s ?? "").split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 100);
  if (searchParams.delivery) {
    const d = await getDelivery(Number(searchParams.delivery));
    if (d) {
      purpose = "delivery"; deliveryId = d.id;
      initial = d.lines.map((l) => ({ variantId: l.variant_id, name: l.common_name, size: l.size_label, priceCents: l.price_cents, quantity: l.quantity, barcode: "" }));
    }
  } else if (searchParams.variant) {
    const vs = await getVariantsByIds(ids(searchParams.variant));
    initial = vs.map((v) => ({ variantId: v.id, name: v.common_name, size: v.size_label, priceCents: v.price_cents, quantity: 1, barcode: v.barcode }));
  }
  if (searchParams.job) {
    const j = await q1<{ id: number; preset_id: number; items: { variantId: number; quantity: number }[] }>(`SELECT id, preset_id, items FROM label_print_jobs WHERE id = $1`, [Number(searchParams.job) || 0]);
    if (j) {
      jobId = j.id; jobPresetId = j.preset_id;
      const vs = await getVariantsByIds(j.items.map((i) => i.variantId));
      initial = j.items.map((i) => { const v = vs.find((x) => x.id === i.variantId)!; return { variantId: i.variantId, name: v?.common_name ?? "?", size: v?.size_label ?? "", priceCents: v?.price_cents ?? 0, quantity: i.quantity, barcode: v?.barcode ?? "" }; });
    }
  }
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Barcode labels" description="Choose the plants, pick your label paper, print. Printing never changes stock." />
      <LabelPrinter
        presets={presets.map((p) => ({ id: p.id, name: p.name, kind: p.kind, slots: p.columns * p.rows, columns: p.columns, rows: p.rows, labelWidthMm: Number(p.label_width_mm), labelHeightMm: Number(p.label_height_mm), pageWidthMm: Number(p.page_width_mm), pageHeightMm: Number(p.page_height_mm), isDefault: p.is_default }))}
        initialItems={initial} initialPurpose={purpose} deliveryId={deliveryId} initialJobId={jobId} initialPresetId={jobPresetId}
        relabel={relabel.map((v) => ({ variantId: v.id, name: v.common_name, size: v.size_label, priceCents: v.price_cents, oldCents: v.old_cents, barcode: v.barcode }))}
        recent={recent.map((j) => ({ id: j.id, purpose: j.purpose, count: j.label_count, at: j.created_at, preset: j.preset_name, by: j.created_by_name, items: j.items }))}
        isOwner={isOwner}
      />
    </div>
  );
}
