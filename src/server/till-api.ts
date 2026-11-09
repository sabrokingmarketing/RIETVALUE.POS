import "server-only";
import type { VariantRow } from "./catalog";
import type { TillItem } from "@/lib/till-types";

export function toTillItem(v: VariantRow): TillItem {
  return { variantId: v.id, name: v.common_name, size: v.size_label, sku: v.sku, barcode: v.barcode, priceCents: v.price_cents, onHand: v.on_hand };
}
