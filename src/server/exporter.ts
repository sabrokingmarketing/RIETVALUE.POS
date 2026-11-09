import "server-only";
import { q } from "./db";
import { assertRole, type Actor } from "./session-types";
import { audit } from "./audit";
import { toCsv, toXlsx } from "./spreadsheet";
import { FIELDS, type FieldKey } from "@/lib/import-fields";
import { todayBusinessDate } from "@/lib/dates";

export type ExportFilters = { term?: string; category?: string; status?: "active" | "archived" | "all"; lowOnly?: boolean };

/** Columns a cashier may export (a price list). Owners get every column. */
const CASHIER_FIELDS: FieldKey[] = ["product_name", "category", "pot_size", "sku", "barcode", "price", "quantity"];

/**
 * Export products in the import template's format, so the file can be edited and imported back:
 * one row per size, grouped by product_handle, barcodes kept as text.
 */
export async function exportProducts(actor: Actor, format: "csv" | "xlsx", f: ExportFilters = {}) {
  assertRole(actor, ["owner", "cashier"]);
  const status = f.status ?? "active";
  const like = `%${(f.term ?? "").trim().replace(/[\\%_]/g, (m) => "\\" + m)}%`;
  const rows = await q<{
    slug: string; common_name: string; botanical_name: string; category: string; description: string; care_notes: string; size_label: string; sku: string;
    barcode: string; aliases: string[] | null; price_cents: number; on_hand: number; low_stock_threshold: number; archived: boolean; photo_source_url: string | null;
  }>(
    `SELECT p.slug, p.common_name, p.botanical_name, c.name AS category, p.description, p.care_notes, v.size_label, v.sku, v.barcode,
            (SELECT array_agg(b.code ORDER BY b.created_at) FROM barcodes b WHERE b.variant_id = v.id AND b.kind = 'alias' AND b.retired_at IS NULL) AS aliases,
            v.price_cents, v.on_hand, v.low_stock_threshold, (v.archived_at IS NOT NULL OR p.archived_at IS NOT NULL) AS archived, p.photo_source_url
     FROM variants v JOIN products p ON p.id = v.product_id JOIN categories c ON c.id = p.category_id
     WHERE (p.common_name ILIKE $1 OR v.sku ILIKE $1 OR v.barcode = $2)
       AND ($3::text IS NULL OR c.slug = $3)
       AND ($4 = 'all' OR ($4 = 'active') = (v.archived_at IS NULL AND p.archived_at IS NULL))
       AND (NOT $5 OR v.on_hand <= v.low_stock_threshold)
     ORDER BY p.common_name, p.id, v.size_label`,
    [like, (f.term ?? "").trim(), f.category || null, status, !!f.lowOnly]);
  const keys: FieldKey[] = actor.role === "owner" ? FIELDS.map((x) => x.key) : CASHIER_FIELDS;
  const value = (r: (typeof rows)[number], k: FieldKey): string | number => {
    switch (k) {
      case "product_handle": return r.slug;
      case "product_name": return r.common_name;
      case "botanical_name": return r.botanical_name;
      case "category": return r.category;
      case "description": return r.description;
      case "care_notes": return r.care_notes;
      case "pot_size": return r.size_label;
      case "sku": return r.sku;
      case "barcode": return r.barcode;
      case "supplier_barcodes": return (r.aliases ?? []).join("|");
      case "price": return (r.price_cents / 100).toFixed(2);
      case "quantity": return r.on_hand;
      case "low_stock_threshold": return r.low_stock_threshold;
      case "status": return r.archived ? "archived" : "active";
      case "image_url": return r.photo_source_url ?? "";
    }
  };
  const body = rows.map((r) => keys.map((k) => value(r, k)));
  await audit(undefined, actor, "export.products", "export", format, { filters: f, rows: rows.length, columns: keys });
  const name = `products-${todayBusinessDate()}.${format}`;
  if (format === "csv") return { name, type: "text/csv; charset=utf-8", body: Buffer.from(toCsv(keys, body)), rows: rows.length };
  const numeric: string[] = ["quantity", "low_stock_threshold"];
  return { name, type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", body: await toXlsx([{ name: "Products", header: keys, rows: body, numeric }]), rows: rows.length };
}

/** The import template: header row, two clearly marked example rows (one plant, two pot sizes) and an instructions sheet. */
export async function importTemplate(format: "csv" | "xlsx") {
  const header = FIELDS.map((f) => f.key);
  const ex1 = { product_handle: "example-lavender", product_name: "EXAMPLE Lavender", botanical_name: "Lavandula angustifolia", category: "Herbs & lavender", description: "Delete these example rows before importing.", care_notes: "Full sun.", pot_size: "15 cm pot", sku: "EX-LAV-15", barcode: "", supplier_barcodes: "", price: "89.90", quantity: "12", low_stock_threshold: "3", status: "active", image_url: "" };
  const ex2 = { ...ex1, pot_size: "20 cm pot", sku: "EX-LAV-20", price: "149.90", quantity: "6", supplier_barcodes: "0060012345678" };
  const rows = [ex1, ex2].map((e) => header.map((k) => e[k as keyof typeof e] ?? ""));
  if (format === "csv") return { name: "product-import-template.csv", type: "text/csv; charset=utf-8", body: Buffer.from(toCsv(header, rows)) };
  const help = FIELDS.map((f) => [f.key, f.label, f.requiredAlways ? "Every row" : f.requiredForCreate ? "New items" : "Optional", f.help]);
  return {
    name: "product-import-template.xlsx", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    body: await toXlsx([
      { name: "Products", header, rows },
      { name: "Instructions", header: ["column", "meaning", "required", "notes"], rows: [
        ...help,
        ["", "", "", ""],
        ["one row per size", "", "", "Each pot or pack size is its own row with its own SKU. Rows with the same product_handle are sizes of one plant."],
        ["matching", "", "", "Rows are matched to existing items by SKU. Keep SKUs the same between imports so nothing is duplicated."],
        ["barcodes", "", "", "Keep the barcode columns formatted as Text so leading zeros are not lost."],
        ["examples", "", "", "The two EXAMPLE rows show the format. Delete them before importing."],
      ], widths: [20, 30, 14, 90] },
    ]),
  };
}
