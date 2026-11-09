import { api } from "@/server/http";
import { requireActor } from "@/server/session";
import { getPreset, labelsFor, renderLabelsPdf } from "@/server/labels";
import { AppError } from "@/server/errors";

/** One label, drawn exactly as it will print, for the live preview. Not recorded as a print job. */
export const GET = api(async (req: Request) => {
  await requireActor(["owner", "cashier"]);
  const u = new URL(req.url).searchParams;
  const variantId = Number(u.get("variant")), presetId = Number(u.get("preset"));
  if (!Number.isInteger(variantId) || !Number.isInteger(presetId)) throw new AppError("VALIDATION", "Choose an item and label paper");
  const preset = await getPreset(presetId);
  if (!preset) throw new AppError("NOT_FOUND", "Label paper not found");
  const single = { ...preset, kind: "roll" as const, page_width_mm: preset.label_width_mm, page_height_mm: preset.label_height_mm, margin_top_mm: 0, margin_left_mm: 0, columns: 1, rows: 1 };
  const pdf = await renderLabelsPdf(single, await labelsFor([{ variantId, quantity: 1 }]), { title: "Label preview" });
  return new Response(Buffer.from(pdf), { headers: { "Content-Type": "application/pdf", "Cache-Control": "no-store" } });
});
