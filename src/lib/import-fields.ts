/**
 * Product spreadsheet columns. The same keys are used by the import template,
 * column auto-mapping, validation and export, so an export can be edited and
 * imported back without losing variation relationships or barcode formatting.
 */
export type FieldKey =
  | "product_handle" | "product_name" | "botanical_name" | "category" | "description" | "care_notes"
  | "pot_size" | "sku" | "barcode" | "supplier_barcodes" | "price" | "quantity" | "low_stock_threshold"
  | "status" | "image_url";

export type FieldDef = {
  key: FieldKey;
  label: string;
  help: string;
  /** Needed on every row (to match or create). */
  requiredAlways?: boolean;
  /** Needed when the row creates a new product size. */
  requiredForCreate?: boolean;
  /** Can be emptied by a blank cell when "blank cells clear values" is chosen. */
  clearable?: boolean;
  aliases: string[];
  example: string;
};

export const FIELDS: FieldDef[] = [
  { key: "product_handle", label: "Product handle", help: "Groups pot sizes into one plant. Optional; defaults to the product name. Keep it stable when renaming.", aliases: ["handle", "product id", "product key", "slug", "parent"], example: "lavender" },
  { key: "product_name", label: "Product name", help: "Common name, as printed on labels.", requiredForCreate: true, aliases: ["name", "common name", "product", "title", "plant"], example: "Lavender" },
  { key: "botanical_name", label: "Botanical name", help: "Optional Latin name.", clearable: true, aliases: ["botanical", "latin name", "scientific name"], example: "Lavandula angustifolia" },
  { key: "category", label: "Category", help: "e.g. Indigenous, Pots. New categories can be created.", requiredForCreate: true, aliases: ["categories", "type", "group", "department"], example: "Herbs & lavender" },
  { key: "description", label: "Description", help: "Optional.", clearable: true, aliases: ["desc", "details", "long description"], example: "Fragrant, silver-leaved and loved by bees." },
  { key: "care_notes", label: "Care notes", help: "Optional.", clearable: true, aliases: ["care", "care instructions"], example: "Full sun, well-drained soil." },
  { key: "pot_size", label: "Pot / pack size (variation)", help: "Each size is a separate item with its own SKU, price and barcode.", requiredForCreate: true, aliases: ["size", "pot size", "pack size", "variation", "variant", "attribute", "option"], example: "15 cm pot" },
  { key: "sku", label: "SKU", help: "Unique per size. Used to match existing items, so keep it the same between imports.", requiredAlways: true, aliases: ["sku code", "item code", "stock code", "product code"], example: "LAV-15" },
  { key: "barcode", label: "Barcode", help: "Label barcode. Leave blank to generate one. Leading zeros are kept. Cannot be changed once set.", aliases: ["ean", "upc", "gtin", "barcode number", "label barcode"], example: "" },
  { key: "supplier_barcodes", label: "Supplier barcodes", help: "Extra barcodes that also scan, separated by |. Added, never removed.", aliases: ["supplier barcode", "alias barcodes", "aliases", "alternate barcodes"], example: "0060012345678" },
  { key: "price", label: "Selling price (R, incl. VAT)", help: "e.g. 89.90", requiredForCreate: true, aliases: ["selling price", "retail price", "price incl vat", "sell price", "rrp"], example: "89.90" },
  { key: "quantity", label: "Stock quantity", help: "Set or add stock depending on the stock option you choose.", aliases: ["qty", "stock", "stock quantity", "on hand", "quantity on hand", "inventory"], example: "12" },
  { key: "low_stock_threshold", label: "Low-stock warning at", help: "Optional, default 3.", aliases: ["low stock", "reorder level", "reorder point", "min stock"], example: "3" },
  { key: "status", label: "Status", help: "active (sellable) or archived. Archived items stop scanning.", aliases: ["publication status", "published", "state"], example: "active" },
  { key: "image_url", label: "Image URL", help: "Optional https:// link to a JPEG, PNG or WebP photo of the plant.", aliases: ["image", "photo", "photo url", "picture"], example: "" },
];

export const FIELD_BY_KEY = Object.fromEntries(FIELDS.map((f) => [f.key, f])) as Record<FieldKey, FieldDef>;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Best-guess mapping from file headers to fields (exact key, label or alias). */
export function autoMap(headers: string[]): Partial<Record<FieldKey, string>> {
  const out: Partial<Record<FieldKey, string>> = {};
  const used = new Set<string>();
  for (const f of FIELDS) {
    const names = [f.key.replace(/_/g, " "), norm(f.label), ...f.aliases].map(norm);
    const hit = headers.find((h) => !used.has(h) && names.includes(norm(h)));
    if (hit) { out[f.key] = hit; used.add(hit); }
  }
  return out;
}

export type ImportOptions = {
  /** create_update: add new sizes and update existing ones; create_only / update_only restrict that. */
  mode: "create_update" | "create_only" | "update_only";
  /** ignore: quantity column is not used; set: replace on-hand with the counted figure; add: add received stock. */
  stock: "ignore" | "set" | "add";
  /** keep: a blank cell leaves the existing value alone; clear: a blank cell empties optional text fields. */
  blanks: "keep" | "clear";
  createCategories: boolean;
  downloadImages: boolean;
};

export const DEFAULT_OPTIONS: ImportOptions = { mode: "create_update", stock: "ignore", blanks: "keep", createCategories: true, downloadImages: true };
