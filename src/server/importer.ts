import "server-only";
import type { PoolClient } from "pg";
import { getPool, q, q1, tx, type Db } from "./db";
import { AppError, isUniqueViolation } from "./errors";
import { assertRole, type Actor } from "./session-types";
import { audit } from "./audit";
import { applyMovement } from "./stock";
import { createProduct, createVariant, slugify, updateVariant, CODE_RE } from "./catalog";
import { readSpreadsheet, unguardCell, toCsv, toXlsx } from "./spreadsheet";
import { fetchProductImage } from "./image-fetch";
import { parseRandToCents } from "@/lib/money";
import { autoMap, DEFAULT_OPTIONS, FIELDS, FIELD_BY_KEY, type FieldKey, type ImportOptions } from "@/lib/import-fields";

const SKU_RE = /^[A-Z0-9][A-Z0-9-]{1,31}$/;
export const BATCH_SIZE = 25;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
/** A row after mapping and normalising. `undefined` = column not mapped or cell blank (see blanks option). */
export type RowData = {
  handle?: string; name?: string; botanical?: string | null; category?: string; description?: string | null; care?: string | null;
  size?: string; sku: string; barcode?: string; supplierBarcodes?: string[]; priceCents?: number; quantity?: number;
  low?: number; status?: "active" | "archived"; imageUrl?: string;
};
type Plan = { action: "create" | "update" | "unchanged" | "skip"; errors: string[]; warnings: string[]; changes: Record<string, [unknown, unknown]> };
type VariantSnap = { id: number; product_id: number; sku: string; size_label: string; barcode: string; price_cents: number; low_stock_threshold: number;
  on_hand: number; archived: boolean; is_public: boolean; product_slug: string; product_name: string; botanical_name: string; description: string; care_notes: string; category: string; photo_source_url: string | null };

/** What the planner needs to know about the current catalogue. Implemented from memory (validation) and from the DB (apply). */
interface Lookup {
  variantBySku(sku: string): Promise<VariantSnap | undefined>;
  productIdBySlug(slug: string): Promise<number | undefined>;
  productSizes(productId: number): Promise<{ size: string; sku: string }[]>;
  codeOwner(code: string): Promise<number | undefined>; // variant id that owns a barcode
  categoryExists(name: string): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Normalising one row
// ---------------------------------------------------------------------------
export function normaliseRow(raw: Record<string, string>, numericCells: string[], mapping: Partial<Record<FieldKey, string>>, opt: ImportOptions) {
  const errors: string[] = []; const warnings: string[] = [];
  const val = (k: FieldKey): string | undefined => {
    const h = mapping[k]; if (!h) return undefined;
    const v = unguardCell(String(raw[h] ?? "")).trim();
    return v === "" ? undefined : v;
  };
  const clearable = (k: FieldKey): string | null | undefined => {
    const v = val(k); if (v !== undefined) return v;
    return mapping[k] && opt.blanks === "clear" && FIELD_BY_KEY[k].clearable ? null : undefined;
  };
  const len = (k: FieldKey, v: string | null | undefined, max: number) => { if (v && v.length > max) errors.push(`${FIELD_BY_KEY[k].label} is longer than ${max} characters.`); return v; };

  const skuRaw = val("sku");
  const sku = (skuRaw ?? "").toUpperCase();
  if (!skuRaw) errors.push("SKU is missing. Every row needs a SKU so it can be matched next time.");
  else if (!SKU_RE.test(sku)) errors.push(`SKU “${skuRaw}” may only use letters, numbers and dashes (2–32 characters).`);

  const d: RowData = { sku };
  const handleSrc = val("product_handle");
  d.name = len("product_name", val("product_name"), 80) ?? undefined;
  if (handleSrc) d.handle = slugify(handleSrc);
  else if (d.name) d.handle = slugify(d.name);
  d.botanical = len("botanical_name", clearable("botanical_name"), 120);
  d.category = len("category", val("category"), 40) ?? undefined;
  d.description = len("description", clearable("description"), 2000);
  d.care = len("care_notes", clearable("care_notes"), 2000);
  d.size = len("pot_size", val("pot_size"), 40) ?? undefined;

  const price = val("price");
  if (price !== undefined) {
    const c = parseRandToCents(price);
    if (c === null || c <= 0) errors.push(`Price “${price}” is not a valid amount above R0 (use e.g. 89.90).`);
    else if (c > 100_000_00) errors.push("Price is too high.");
    else d.priceCents = c;
  }
  const qty = val("quantity");
  if (qty !== undefined && opt.stock !== "ignore") {
    if (!/^\d{1,6}$/.test(qty)) errors.push(`Quantity “${qty}” must be a whole number of 0 or more.`);
    else d.quantity = Number(qty);
  }
  const low = val("low_stock_threshold");
  if (low !== undefined) { if (!/^\d{1,5}$/.test(low)) errors.push(`Low-stock warning “${low}” must be a whole number.`); else d.low = Number(low); }
  const status = val("status")?.toLowerCase();
  if (status !== undefined) {
    if (["active", "published", "publish", "yes", "y", "1", "true", "instock", "in stock"].includes(status)) d.status = "active";
    else if (["archived", "archive", "draft", "inactive", "no", "n", "0", "false", "hidden"].includes(status)) d.status = "archived";
    else errors.push(`Status “${status}” must be active or archived.`);
  }
  const bc = val("barcode");
  if (bc !== undefined) {
    if (!CODE_RE.test(bc)) errors.push(`Barcode “${bc}” has spaces or unsupported characters.`);
    else d.barcode = bc;
    if (mapping.barcode && numericCells.includes(mapping.barcode)) {
      warnings.push(`Barcode ${bc} was stored as a number in the spreadsheet, so leading zeros may already have been lost. Format the barcode column as Text.`);
    }
  }
  const sup = val("supplier_barcodes");
  if (sup !== undefined) {
    const codes = [...new Set(sup.split(/[|]/).map((s) => s.trim()).filter(Boolean))];
    const bad = codes.filter((c) => !CODE_RE.test(c));
    if (bad.length) errors.push(`Supplier barcode “${bad[0]}” has spaces or unsupported characters (separate several with |).`);
    else d.supplierBarcodes = codes;
  }
  const img = val("image_url");
  if (img !== undefined && opt.downloadImages) {
    try { const u = new URL(img); if (u.protocol !== "https:") throw 0; d.imageUrl = u.toString(); }
    catch { errors.push("Image URL must be a full https:// address."); }
  }
  return { data: d, errors, warnings };
}

// ---------------------------------------------------------------------------
// Planning one row against the catalogue
// ---------------------------------------------------------------------------
async function planRow(d: RowData, opt: ImportOptions, L: Lookup): Promise<Plan> {
  const errors: string[] = []; const warnings: string[] = []; const changes: Plan["changes"] = {};
  const v = await L.variantBySku(d.sku);
  if (v) {
    if (opt.mode === "create_only") return { action: "skip", errors, warnings: ["SKU already exists; “create new only” was chosen."], changes };
    if (d.handle && d.handle !== v.product_slug) {
      const other = await L.productIdBySlug(d.handle);
      if (other !== v.product_id) errors.push(`SKU ${d.sku} belongs to “${v.product_name}” (handle ${v.product_slug}), but this row puts it under handle “${d.handle}”. Sizes cannot move between products — fix the handle or the SKU.`);
    }
    if (d.barcode && d.barcode !== v.barcode) {
      const owner = await L.codeOwner(d.barcode);
      if (owner !== v.id) errors.push(`Barcode cannot be changed for an existing size (it is ${v.barcode}). Leave the cell blank, or add the new code under Supplier barcodes.`);
    }
    for (const code of d.supplierBarcodes ?? []) {
      const owner = await L.codeOwner(code);
      if (owner !== undefined && owner !== v.id) errors.push(`Supplier barcode ${code} is already registered to another item. Codes are never reused.`);
    }
    if (d.size && d.size !== v.size_label) {
      const clash = (await L.productSizes(v.product_id)).find((s) => s.size.toLowerCase() === d.size!.toLowerCase() && s.sku !== v.sku);
      if (clash) errors.push(`“${v.product_name}” already has a size “${d.size}” (SKU ${clash.sku}).`);
    }
    if (d.category && !(await L.categoryExists(d.category)) && !opt.createCategories) errors.push(`Category “${d.category}” does not exist. Tick “Create missing categories” or fix the name.`);
    const cmp = (key: string, from: unknown, to: unknown) => { if (to !== undefined && to !== from) changes[key] = [from, to]; };
    cmp("name", v.product_name, d.name);
    cmp("botanical", v.botanical_name, d.botanical === null ? "" : d.botanical);
    cmp("category", v.category, d.category);
    cmp("description", v.description, d.description === null ? "" : d.description);
    cmp("care", v.care_notes, d.care === null ? "" : d.care);
    cmp("size", v.size_label, d.size);
    cmp("price", v.price_cents, d.priceCents);
    cmp("low", v.low_stock_threshold, d.low);
    cmp("status", v.archived ? "archived" : "active", d.status);
    const newAliases = d.supplierBarcodes ?? [];
    if (newAliases.length) {
      const missing: string[] = [];
      for (const c of newAliases) if ((await L.codeOwner(c)) !== v.id) missing.push(c);
      if (missing.length) changes.supplier_barcodes = [null, missing];
    }
    if (d.quantity !== undefined) {
      if (opt.stock === "set" && d.quantity !== v.on_hand) changes.stock = [v.on_hand, d.quantity];
      if (opt.stock === "add" && d.quantity > 0) changes.stock = [v.on_hand, v.on_hand + d.quantity];
    }
    if (d.imageUrl && d.imageUrl !== v.photo_source_url) changes.image = [v.photo_source_url, d.imageUrl];
    if (d.status === "archived" && changes.stock) warnings.push("Stock changes on an archived item are still recorded.");
    return { action: errors.length ? "update" : Object.keys(changes).length ? "update" : "unchanged", errors, warnings, changes };
  }
  // New size
  if (opt.mode === "update_only") return { action: "skip", errors, warnings: ["SKU not found; “update existing only” was chosen."], changes };
  const productId = d.handle ? await L.productIdBySlug(d.handle) : undefined;
  if (!d.size) errors.push("Pot / pack size is required to create a new item.");
  if (d.priceCents === undefined) errors.push("Selling price is required to create a new item.");
  if (!productId) {
    if (!d.name) errors.push("Product name is required to create a new plant.");
    if (!d.category) errors.push("Category is required to create a new plant.");
  }
  if (d.category && !(await L.categoryExists(d.category)) && !opt.createCategories) errors.push(`Category “${d.category}” does not exist. Tick “Create missing categories” or fix the name.`);
  if (productId && d.size) {
    const clash = (await L.productSizes(productId)).find((s) => s.size.toLowerCase() === d.size!.toLowerCase());
    if (clash) errors.push(`This plant already has a size “${d.size}” with SKU ${clash.sku}. Use that SKU to update it.`);
  }
  for (const code of [d.barcode, ...(d.supplierBarcodes ?? [])].filter(Boolean) as string[]) {
    if ((await L.codeOwner(code)) !== undefined) errors.push(`Barcode ${code} is already registered to another item. Codes are never reused.`);
  }
  if (d.quantity !== undefined && d.quantity > 0 && opt.stock !== "ignore") changes.stock = [0, d.quantity];
  if (d.status === "archived") warnings.push("This new item will be created as archived and will not scan.");
  return { action: "create", errors, warnings, changes };
}

// --- lookups ---------------------------------------------------------------
const VSNAP = `SELECT v.id, v.product_id, v.sku, v.size_label, v.barcode, v.price_cents, v.low_stock_threshold, v.on_hand, v.is_public,
  (v.archived_at IS NOT NULL) AS archived, p.slug AS product_slug, p.common_name AS product_name, p.botanical_name, p.description,
  p.care_notes, c.name AS category, p.photo_source_url
  FROM variants v JOIN products p ON p.id = v.product_id JOIN categories c ON c.id = p.category_id`;

function dbLookup(db: Db): Lookup {
  return {
    variantBySku: (sku) => q1<VariantSnap>(`${VSNAP} WHERE v.sku = $1`, [sku], db),
    productIdBySlug: async (slug) => (await q1<{ id: number }>(`SELECT id FROM products WHERE slug = $1`, [slug], db))?.id,
    productSizes: (pid) => q<{ size: string; sku: string }>(`SELECT size_label AS size, sku FROM variants WHERE product_id = $1`, [pid], db),
    codeOwner: async (code) => (await q1<{ variant_id: number }>(`SELECT variant_id FROM barcodes WHERE code = $1`, [code], db))?.variant_id,
    categoryExists: async (name) => !!(await q1(`SELECT 1 FROM categories WHERE lower(name) = lower($1)`, [name], db)),
  };
}

async function memoryLookup(): Promise<Lookup> {
  const vs = await q<VariantSnap>(VSNAP);
  const bySku = new Map(vs.map((v) => [v.sku, v]));
  const products = new Map((await q<{ id: number; slug: string }>(`SELECT id, slug FROM products`)).map((p) => [p.slug, p.id]));
  const sizes = new Map<number, { size: string; sku: string }[]>();
  for (const v of vs) { const a = sizes.get(v.product_id) ?? []; a.push({ size: v.size_label, sku: v.sku }); sizes.set(v.product_id, a); }
  const codes = new Map((await q<{ code: string; variant_id: number }>(`SELECT code, variant_id FROM barcodes`)).map((b) => [b.code, b.variant_id]));
  const cats = new Set((await q<{ name: string }>(`SELECT name FROM categories`)).map((c) => c.name.toLowerCase()));
  return {
    variantBySku: async (s) => bySku.get(s),
    productIdBySlug: async (s) => products.get(s),
    productSizes: async (id) => sizes.get(id) ?? [],
    codeOwner: async (c) => codes.get(c),
    categoryExists: async (n) => cats.has(n.toLowerCase()),
  };
}

// ---------------------------------------------------------------------------
// Jobs: upload → map → validate/preview → start → process → retry
// ---------------------------------------------------------------------------
export type JobSummary = {
  id: string; fileName: string; format: string; status: string; createdAt: string; createdBy: string; totalRows: number;
  headers: string[]; mapping: Partial<Record<FieldKey, string>>; options: ImportOptions; lastError: string | null;
  counts: { new: number; pending: number; ok: number; failed: number; skipped: number };
  actions: { create: number; update: number; unchanged: number; skip: number };
  newProducts: number; startedAt: string | null; finishedAt: string | null;
};

export async function createImportJob(actor: Actor, fileName: string, bytes: Buffer) {
  assertRole(actor, ["owner"]);
  const safeName = fileName.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "upload";
  const sheet = await readSpreadsheet(safeName, bytes);
  const mapping = autoMap(sheet.headers);
  const id = await tx(async (c) => {
    const job = await q1<{ id: string }>(
      `INSERT INTO import_jobs (created_by, file_name, format, headers, mapping, options, total_rows) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [actor.id, safeName, sheet.format, JSON.stringify(sheet.headers), JSON.stringify(mapping), JSON.stringify(DEFAULT_OPTIONS), sheet.rows.length], c);
    for (let i = 0; i < sheet.rows.length; i += 1000) {
      const chunk = sheet.rows.slice(i, i + 1000);
      await c.query(
        `INSERT INTO import_rows (job_id, row_no, raw, changes)
         SELECT $1, r.row_no, r.raw, jsonb_build_object('_numeric', r.numeric) FROM jsonb_to_recordset($2::jsonb) AS r(row_no int, raw jsonb, numeric jsonb)`,
        [job!.id, JSON.stringify(chunk.map((r) => ({ row_no: r.rowNo, raw: r.cells, numeric: r.numericCells })))]);
    }
    await audit(c, actor, "import.upload", "import_job", job!.id, { fileName: safeName, rows: sheet.rows.length, format: sheet.format });
    return job!.id;
  });
  return getJob(actor, id);
}

export async function getJob(actor: Actor, id: string): Promise<JobSummary> {
  assertRole(actor, ["owner"]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AppError("NOT_FOUND", "Import not found");
  const j = await q1<{ id: string; file_name: string; format: string; status: string; created_at: string; created_by: string; total_rows: number; headers: string[];
    mapping: Partial<Record<FieldKey, string>>; options: ImportOptions; last_error: string | null; started_at: string | null; finished_at: string | null }>(
    `SELECT j.*, u.name AS created_by FROM import_jobs j JOIN "user" u ON u.id = j.created_by WHERE j.id = $1`, [id]);
  if (!j) throw new AppError("NOT_FOUND", "Import not found");
  const counts = { new: 0, pending: 0, ok: 0, failed: 0, skipped: 0 };
  for (const r of await q<{ status: keyof typeof counts; n: number }>(`SELECT status, count(*)::int AS n FROM import_rows WHERE job_id = $1 GROUP BY status`, [id])) counts[r.status] = r.n;
  const actions = { create: 0, update: 0, unchanged: 0, skip: 0 };
  for (const r of await q<{ action: keyof typeof actions; n: number }>(`SELECT action, count(*)::int AS n FROM import_rows WHERE job_id = $1 AND action IS NOT NULL AND status <> 'failed' GROUP BY action`, [id])) actions[r.action] = r.n;
  const np = await q1<{ n: number }>(
    `SELECT count(DISTINCT data->>'handle')::int AS n FROM import_rows r WHERE job_id = $1 AND action = 'create' AND status IN ('pending','ok')
       AND NOT EXISTS (SELECT 1 FROM products p WHERE p.slug = r.data->>'handle' AND p.created_at < (SELECT created_at FROM import_jobs WHERE id = $1))`, [id]);
  return {
    id: j.id, fileName: j.file_name, format: j.format, status: j.status, createdAt: j.created_at, createdBy: j.created_by, totalRows: j.total_rows,
    headers: j.headers, mapping: j.mapping, options: { ...DEFAULT_OPTIONS, ...j.options }, lastError: j.last_error, counts, actions, newProducts: np?.n ?? 0,
    startedAt: j.started_at, finishedAt: j.finished_at,
  };
}

export type RowView = { rowNo: number; status: string; action: string | null; message: string; warnings: string[]; changes: Record<string, [unknown, unknown]>;
  sku: string; name: string; size: string; raw: Record<string, string> };

export async function listRows(actor: Actor, id: string, opts: { status?: string; limit?: number; offset?: number } = {}) {
  assertRole(actor, ["owner"]);
  const rows = await q<{ row_no: number; status: string; action: string | null; message: string; warnings: unknown; changes: Record<string, [unknown, unknown]>; data: RowData | null; raw: Record<string, string> }>(
    `SELECT row_no, status, action, message, warnings, changes, data, raw FROM import_rows WHERE job_id = $1 AND ($2::text IS NULL OR status = $2)
     ORDER BY row_no LIMIT $3 OFFSET $4`, [id, opts.status ?? null, Math.min(opts.limit ?? 200, 1000), opts.offset ?? 0]);
  return rows.map((r): RowView => ({
    rowNo: r.row_no, status: r.status, action: r.action, message: r.message, warnings: Array.isArray(r.warnings) ? r.warnings.filter((w): w is string => typeof w === "string") : [],
    changes: r.changes ?? {}, sku: r.data?.sku ?? "", name: r.data?.name ?? "", size: r.data?.size ?? "", raw: r.raw,
  }));
}

function checkMapping(mapping: Partial<Record<FieldKey, string>>, headers: string[]) {
  for (const [k, h] of Object.entries(mapping)) {
    if (!(k in FIELD_BY_KEY)) throw new AppError("VALIDATION", `Unknown field ${k}`);
    if (h && !headers.includes(h)) throw new AppError("VALIDATION", `Column “${h}” is not in the file.`);
  }
  const cols = Object.values(mapping).filter(Boolean);
  if (new Set(cols).size !== cols.length) throw new AppError("VALIDATION", "The same column is mapped to two fields. Map each column once.");
  if (!mapping.sku) throw new AppError("VALIDATION", "Map a column to SKU — it is how rows are matched to existing items.");
}

function parseOptions(o: Partial<ImportOptions>): ImportOptions {
  const out = { ...DEFAULT_OPTIONS, ...o };
  if (!["create_update", "create_only", "update_only"].includes(out.mode)) throw new AppError("VALIDATION", "Choose what the import may do.");
  if (!["ignore", "set", "add"].includes(out.stock)) throw new AppError("VALIDATION", "Choose how quantities are used.");
  if (!["keep", "clear"].includes(out.blanks)) throw new AppError("VALIDATION", "Choose what blank cells do.");
  return { mode: out.mode, stock: out.stock, blanks: out.blanks, createCategories: !!out.createCategories, downloadImages: !!out.downloadImages };
}

/** Map, normalise and check every row; record the planned action per row. Writes nothing to the catalogue. */
export async function validateJob(actor: Actor, id: string, input: { mapping: Partial<Record<FieldKey, string>>; options: Partial<ImportOptions> }) {
  const job = await getJob(actor, id);
  if (!["uploaded", "validated"].includes(job.status)) throw new AppError("CONFLICT", "This import has already started. Start a new import to change the mapping.");
  const mapping = Object.fromEntries(Object.entries(input.mapping ?? {}).filter(([, v]) => v)) as Partial<Record<FieldKey, string>>;
  checkMapping(mapping, job.headers);
  const opt = parseOptions(input.options ?? {});
  const rows = await q<{ row_no: number; raw: Record<string, string>; changes: { _numeric?: string[] } | null; data: { _numeric?: string[] } | null }>(
    `SELECT row_no, raw, changes, data FROM import_rows WHERE job_id = $1 ORDER BY row_no`, [id]);
  const L = await memoryLookup();
  const results = await evaluateRows(rows.map((r) => ({ rowNo: r.row_no, raw: r.raw, numeric: r.data?._numeric ?? r.changes?._numeric ?? [] })), mapping, opt, L);
  await saveEvaluations(id, results, "pending");
  await q(`UPDATE import_jobs SET mapping = $2, options = $3, status = 'validated' WHERE id = $1`, [id, JSON.stringify(mapping), JSON.stringify(opt)]);
  return getJob(actor, id);
}

type Eval = { rowNo: number; data: RowData; status: "pending" | "failed" | "skipped"; action: Plan["action"] | null; message: string; warnings: string[]; changes: Plan["changes"]; numeric: string[] };

async function evaluateRows(rows: { rowNo: number; raw: Record<string, string>; numeric: string[] }[], mapping: Partial<Record<FieldKey, string>>, opt: ImportOptions, L: Lookup, contextRows?: RowData[]): Promise<Eval[]> {
  const norm = rows.map((r) => ({ ...r, ...normaliseRow(r.raw, r.numeric, mapping, opt) }));
  // Cross-row checks within the file (plus any context rows from the same job).
  const all = [...norm.map((n) => ({ rowNo: n.rowNo, d: n.data })), ...(contextRows ?? []).map((d) => ({ rowNo: -1, d }))];
  const bySku = new Map<string, number[]>(); const byCode = new Map<string, Set<string>>(); const bySize = new Map<string, Set<string>>(); const nameOf = new Map<string, { name?: string; category?: string; row: number }>();
  for (const { rowNo, d } of all) {
    if (d.sku) bySku.set(d.sku, [...(bySku.get(d.sku) ?? []), rowNo]);
    for (const c of [d.barcode, ...(d.supplierBarcodes ?? [])].filter(Boolean) as string[]) { const s = byCode.get(c) ?? new Set(); s.add(d.sku); byCode.set(c, s); }
    if (d.handle && d.size) { const k = `${d.handle}\u0000${d.size.toLowerCase()}`; const s = bySize.get(k) ?? new Set(); s.add(d.sku); bySize.set(k, s); }
  }
  const out: Eval[] = [];
  for (const n of norm) {
    const d = n.data; const errors = [...n.errors]; const warnings = [...n.warnings];
    const dupes = (bySku.get(d.sku) ?? []).filter((x) => x !== n.rowNo);
    if (d.sku && dupes.length) errors.push(`SKU ${d.sku} also appears on row ${dupes.filter((x) => x > 0).join(", ") || "another file row"}. Each SKU may appear once.`);
    for (const c of [d.barcode, ...(d.supplierBarcodes ?? [])].filter(Boolean) as string[]) if ((byCode.get(c)?.size ?? 0) > 1) errors.push(`Barcode ${c} is used by more than one SKU in this file.`);
    if (d.handle && d.size && (bySize.get(`${d.handle}\u0000${d.size.toLowerCase()}`)?.size ?? 0) > 1) errors.push(`Size “${d.size}” appears twice for the same product with different SKUs. Each size needs one row.`);
    if (d.handle) {
      const first = nameOf.get(d.handle);
      if (!first) nameOf.set(d.handle, { name: d.name, category: d.category, row: n.rowNo });
      else {
        if (d.name && first.name && d.name !== first.name) warnings.push(`Product name differs from row ${first.row} (“${first.name}”) for the same handle; the last value imported wins.`);
        if (d.category && first.category && d.category !== first.category) errors.push(`Category “${d.category}” differs from row ${first.row} (“${first.category}”) for the same product. Use one category per product.`);
      }
    }
    let plan: Plan = { action: "skip", errors: [], warnings: [], changes: {} };
    if (!errors.length) plan = await planRow(d, opt, L);
    errors.push(...plan.errors); warnings.push(...plan.warnings);
    out.push({
      rowNo: n.rowNo, data: d, numeric: n.numeric, changes: plan.changes, warnings,
      status: errors.length ? "failed" : plan.action === "skip" ? "skipped" : "pending",
      action: errors.length && plan.action === "skip" ? null : plan.action,
      message: errors.join(" "),
    });
  }
  return out;
}

async function saveEvaluations(jobId: string, evals: Eval[], _okStatus: "pending") {
  for (let i = 0; i < evals.length; i += 1000) {
    const chunk = evals.slice(i, i + 1000);
    await q(
      `UPDATE import_rows r SET data = e.data, status = e.status, action = e.action, message = e.message, warnings = e.warnings, changes = e.changes
       FROM jsonb_to_recordset($2::jsonb) AS e(row_no int, data jsonb, status text, action text, message text, warnings jsonb, changes jsonb)
       WHERE r.job_id = $1 AND r.row_no = e.row_no`,
      [jobId, JSON.stringify(chunk.map((e) => ({ row_no: e.rowNo, data: { ...e.data, _numeric: e.numeric }, status: e.status, action: e.action ?? null, message: e.message, warnings: e.warnings, changes: e.changes })))]);
  }
}

/** Confirm: queue the validated rows for background processing. */
export async function startJob(actor: Actor, id: string) {
  const job = await getJob(actor, id);
  if (job.status !== "validated") throw new AppError("CONFLICT", job.status === "uploaded" ? "Check the file first (Validate and preview)." : "This import has already been started.");
  if (job.counts.pending === 0) throw new AppError("VALIDATION", "No rows are ready to import. Fix the failed rows first.");
  await q(`UPDATE import_jobs SET status = 'queued', last_error = NULL WHERE id = $1 AND status = 'validated'`, [id]);
  await audit(undefined, actor, "import.start", "import_job", id, { rows: job.counts.pending, options: job.options, mapping: job.mapping });
  kickImportWorker();
  return getJob(actor, id);
}

export async function cancelJob(actor: Actor, id: string) {
  await getJob(actor, id);
  await q(`UPDATE import_jobs SET status = 'cancelled', finished_at = now() WHERE id = $1 AND status IN ('uploaded','validated','queued','running')`, [id]);
  await q(`UPDATE import_rows SET status = 'skipped', message = 'Import cancelled before this row was processed.' WHERE job_id = $1 AND status IN ('pending','new')`, [id]);
  await audit(undefined, actor, "import.cancel", "import_job", id, {});
  return getJob(actor, id);
}

/** Correct a failed row's cells and re-check it. */
export async function editRow(actor: Actor, id: string, rowNo: number, cells: Record<string, string>) {
  const job = await getJob(actor, id);
  const row = await q1<{ raw: Record<string, string>; status: string; data: (RowData & { _numeric?: string[] }) | null }>(`SELECT raw, status, data FROM import_rows WHERE job_id = $1 AND row_no = $2`, [id, rowNo]);
  if (!row) throw new AppError("NOT_FOUND", "Row not found");
  if (row.status !== "failed") throw new AppError("CONFLICT", "Only failed rows can be corrected.");
  const raw = { ...row.raw };
  for (const [h, v] of Object.entries(cells)) { if (!job.headers.includes(h)) throw new AppError("VALIDATION", `Unknown column ${h}`); raw[h] = String(v).slice(0, 4000); }
  await q(`UPDATE import_rows SET raw = $3 WHERE job_id = $1 AND row_no = $2`, [id, rowNo, JSON.stringify(raw)]);
  await audit(undefined, actor, "import.row_edit", "import_job", id, { rowNo, cells });
  // Before the import starts, a corrected row simply joins the preview; afterwards it is imported straight away.
  return revalidateFailed(actor, id, [rowNo], job.status !== "validated");
}

/** Re-check failed rows (after corrections or catalogue changes) and queue the ones that now pass. */
export async function revalidateFailed(actor: Actor, id: string, onlyRows?: number[], queue = true) {
  const job = await getJob(actor, id);
  if (job.status === "cancelled") throw new AppError("CONFLICT", "This import was cancelled. Start a new one.");
  if (job.status === "uploaded") throw new AppError("CONFLICT", "Validate the file first.");
  const failed = await q<{ row_no: number; raw: Record<string, string>; data: { _numeric?: string[] } | null }>(
    `SELECT row_no, raw, data FROM import_rows WHERE job_id = $1 AND status = 'failed' AND ($2::int[] IS NULL OR row_no = ANY($2::int[])) ORDER BY row_no`, [id, onlyRows ?? null]);
  const L = await memoryLookup();
  // Rows already imported are now part of the catalogue, so only still-pending ones are cross-checked against the file.
  const pendingCtx = (await q<{ data: RowData }>(`SELECT data FROM import_rows WHERE job_id = $1 AND status = 'pending' AND data IS NOT NULL`, [id])).map((r) => r.data);
  const evals = await evaluateRows(failed.map((r) => ({ rowNo: r.row_no, raw: r.raw, numeric: r.data?._numeric ?? [] })), job.mapping, job.options, L, pendingCtx);
  await saveEvaluations(id, evals, "pending");
  const nowPending = (await q1<{ n: number }>(`SELECT count(*)::int AS n FROM import_rows WHERE job_id = $1 AND status = 'pending'`, [id]))!.n;
  if (queue && nowPending > 0 && ["completed", "queued", "running"].includes(job.status)) {
    await q(`UPDATE import_jobs SET status = 'queued', finished_at = NULL WHERE id = $1`, [id]);
    await audit(undefined, actor, "import.retry", "import_job", id, { rows: nowPending });
    kickImportWorker();
  }
  return getJob(actor, id);
}

export async function recentJobs(actor: Actor, limit = 10) {
  assertRole(actor, ["owner"]);
  return q<{ id: string; file_name: string; status: string; created_at: string; total_rows: number; ok: number; failed: number; created_by: string }>(
    `SELECT j.id, j.file_name, j.status, j.created_at, j.total_rows, u.name AS created_by,
       (SELECT count(*)::int FROM import_rows r WHERE r.job_id = j.id AND r.status = 'ok') AS ok,
       (SELECT count(*)::int FROM import_rows r WHERE r.job_id = j.id AND r.status = 'failed') AS failed
     FROM import_jobs j JOIN "user" u ON u.id = j.created_by ORDER BY j.created_at DESC LIMIT $1`, [limit]);
}

// ---------------------------------------------------------------------------
// Background worker
// ---------------------------------------------------------------------------
let workerRunning: Promise<void> | null = null;

/** Start processing queued imports in this process (no-op if already running here). */
export function kickImportWorker(): Promise<void> {
  if (!workerRunning) {
    workerRunning = runQueuedImports().catch((e) => console.error("[import-worker]", e)).finally(() => { workerRunning = null; });
  }
  return workerRunning;
}

/** Process every queued (or stalled) job until none remain. Safe to run in several processes at once. */
export async function runQueuedImports(): Promise<void> {
  for (;;) {
    const job = await q1<{ id: string; created_by: string; options: ImportOptions; mapping: Partial<Record<FieldKey, string>> }>(
      `UPDATE import_jobs SET status = 'running', started_at = coalesce(started_at, now()), heartbeat_at = now()
       WHERE id = (SELECT id FROM import_jobs WHERE status = 'queued' OR (status = 'running' AND heartbeat_at < now() - interval '2 minutes')
                   ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
       RETURNING id, created_by, options, mapping`);
    if (!job) return;
    await runJob(job.id, job.created_by, { ...DEFAULT_OPTIONS, ...job.options });
  }
}

async function runJob(jobId: string, createdBy: string, opt: ImportOptions) {
  const owner = await q1<{ id: string; name: string; email: string; role: "owner" | "cashier"; active: boolean }>(`SELECT id, name, email, role, active FROM "user" WHERE id = $1`, [createdBy]);
  if (!owner?.active || owner.role !== "owner") {
    await q(`UPDATE import_jobs SET status = 'completed', finished_at = now(), last_error = 'Stopped: the person who started this import no longer has owner access.' WHERE id = $1`, [jobId]);
    await q(`UPDATE import_rows SET status = 'failed', message = 'Not processed: the import was stopped because its owner lost access.' WHERE job_id = $1 AND status = 'pending'`, [jobId]);
    return;
  }
  const actor: Actor = { id: owner.id, name: owner.name, email: owner.email, role: owner.role };
  for (;;) {
    const st = await q1<{ status: string }>(`SELECT status FROM import_jobs WHERE id = $1`, [jobId]);
    if (st?.status !== "running") return; // cancelled
    const batch = await q<{ row_no: number }>(`SELECT row_no FROM import_rows WHERE job_id = $1 AND status = 'pending' ORDER BY row_no LIMIT $2`, [jobId, BATCH_SIZE]);
    if (batch.length === 0) {
      await q(`UPDATE import_jobs SET status = 'completed', finished_at = now() WHERE id = $1 AND status = 'running'`, [jobId]);
      await audit(undefined, actor, "import.complete", "import_job", jobId, {});
      return;
    }
    for (const r of batch) await processRow(jobId, r.row_no, actor, opt);
    await q(`UPDATE import_jobs SET heartbeat_at = now() WHERE id = $1`, [jobId]);
  }
}

const KIND = (category: string): "plant" | "pot" | "supply" =>
  /\bpots?\b|planter|container/i.test(category) ? "pot" : /soil|compost|fertili[sz]er|suppl|tool|mulch|seed|pesticide|bark/i.test(category) ? "supply" : "plant";

/** Import one row in its own transaction. Re-checks the row against the live catalogue; idempotent per row. */
export async function processRow(jobId: string, rowNo: number, actor: Actor, opt: ImportOptions) {
  // Fetch an image (outside the transaction) if this row will need it.
  const pre = await q1<{ data: RowData; changes: Record<string, unknown>; status: string }>(`SELECT data, changes, status FROM import_rows WHERE job_id = $1 AND row_no = $2`, [jobId, rowNo]);
  if (!pre || pre.status !== "pending") return;
  let image: { fileName: string } | { error: string } | null = null;
  if (pre.data.imageUrl && opt.downloadImages) {
    const already = await q1(`SELECT 1 FROM products WHERE photo_source_url = $1`, [pre.data.imageUrl]);
    if (!already) image = await fetchProductImage(pre.data.imageUrl).then((f) => ({ fileName: f }), (e: unknown) => ({ error: e instanceof AppError ? e.message : "Download failed" }));
  }
  try {
    await tx(async (c) => {
      const row = await q1<{ data: RowData; status: string; warnings: unknown }>(`SELECT data, status, warnings FROM import_rows WHERE job_id = $1 AND row_no = $2 FOR UPDATE SKIP LOCKED`, [jobId, rowNo], c);
      if (!row || row.status !== "pending") return; // another worker has it, or it is already done
      const d = row.data;
      const L = dbLookup(c);
      const plan = await planRow(d, opt, L);
      if (plan.errors.length) {
        await q(`UPDATE import_rows SET status = 'failed', message = $3, attempts = attempts + 1, processed_at = now() WHERE job_id = $1 AND row_no = $2`, [jobId, rowNo, plan.errors.join(" ")], c);
        return;
      }
      const earlier = Array.isArray(row.warnings) ? row.warnings.filter((w): w is string => typeof w === "string") : [];
      const warnings = [...new Set([...earlier, ...plan.warnings])];
      if (plan.action === "skip") {
        await q(`UPDATE import_rows SET status = 'skipped', action = 'skip', warnings = $3, attempts = attempts + 1, processed_at = now() WHERE job_id = $1 AND row_no = $2`, [jobId, rowNo, JSON.stringify(warnings)], c);
        return;
      }
      const ref = `${jobId}:${rowNo}`;
      const categoryId = d.category ? await ensureCategory(c, d.category, opt) : undefined;
      let variantId: number; let productId: number;
      const existing = await L.variantBySku(d.sku);
      if (existing) {
        variantId = existing.id; productId = existing.product_id;
        await updateProductFields(c, actor, productId, d, categoryId, existing);
        if (plan.changes.size || plan.changes.price || plan.changes.low) {
          await updateVariant(actor, variantId, {
            sizeLabel: d.size ?? existing.size_label, sku: existing.sku, priceCents: d.priceCents ?? existing.price_cents,
            lowStockThreshold: d.low ?? existing.low_stock_threshold, isPublic: existing.is_public,
          }, { db: c, source: "edit" });
        }
      } else {
        const pid = d.handle ? await L.productIdBySlug(d.handle) : undefined;
        if (pid) { productId = pid; await updateProductFields(c, actor, productId, d, categoryId); }
        else {
          productId = await createProduct(actor, { commonName: d.name!, botanicalName: d.botanical ?? "", categoryId: categoryId!, description: d.description ?? "", careNotes: d.care ?? "" }, c);
          if (d.handle) {
            const taken = await q1(`SELECT 1 FROM products WHERE slug = $1 AND id <> $2`, [d.handle, productId], c);
            if (!taken) await q(`UPDATE products SET slug = $2 WHERE id = $1`, [productId, d.handle], c);
          }
        }
        variantId = await createVariant(actor, productId, { sizeLabel: d.size!, sku: d.sku, priceCents: d.priceCents!, lowStockThreshold: d.low ?? 3, barcode: d.barcode ?? "" }, c);
      }
      for (const code of d.supplierBarcodes ?? []) {
        const owner = await L.codeOwner(code);
        if (owner === undefined) await q(`INSERT INTO barcodes (code, variant_id, kind, created_by) VALUES ($1,$2,'alias',$3)`, [code, variantId, actor.id], c);
      }
      if (d.status) await q(`UPDATE variants SET archived_at = CASE WHEN $2 THEN coalesce(archived_at, now()) ELSE NULL END WHERE id = $1`, [variantId, d.status === "archived"], c);
      // Stock: exactly once per row, guarded by a unique movement reference.
      if (d.quantity !== undefined && opt.stock !== "ignore") {
        const done = await q1(`SELECT 1 FROM stock_movements WHERE source_type = 'import' AND source_ref = $1 AND variant_id = $2`, [ref, variantId], c);
        if (!done) {
          const cur = (await q1<{ on_hand: number }>(`SELECT on_hand FROM variants WHERE id = $1 FOR UPDATE`, [variantId], c))!.on_hand;
          const delta = opt.stock === "set" ? d.quantity - cur : d.quantity;
          if (delta !== 0) await applyMovement(c, { variantId, delta, reason: opt.stock === "set" ? "count_correction" : "receive", operatorId: actor.id, sourceType: "import", sourceRef: ref, note: opt.stock === "set" ? "Import: stock count" : "Import: stock received" });
        }
      }
      if (image) {
        if ("fileName" in image) await q(`UPDATE products SET photo_path = $2, photo_is_fixture = false, photo_source_url = $3 WHERE id = $1`, [productId, image.fileName, d.imageUrl], c);
        else warnings.push(`Image not imported: ${image.error}`);
      }
      await q(`UPDATE import_rows SET status = 'ok', action = $3, changes = $4, warnings = $5, product_id = $6, variant_id = $7, message = '', attempts = attempts + 1, processed_at = now()
               WHERE job_id = $1 AND row_no = $2`, [jobId, rowNo, plan.action, JSON.stringify(plan.changes), JSON.stringify(warnings), productId, variantId], c);
      await audit(c, actor, `import.${plan.action}`, "variant", variantId, { jobId, rowNo, sku: d.sku, changes: plan.changes });
    });
  } catch (e) {
    const msg = e instanceof AppError ? e.message : isUniqueViolation(e) ? "Another item already uses one of these identifiers." : "Unexpected error while saving this row.";
    if (!(e instanceof AppError)) console.error("[import-worker] row", jobId, rowNo, e);
    await q(`UPDATE import_rows SET status = 'failed', message = $3, attempts = attempts + 1, processed_at = now() WHERE job_id = $1 AND row_no = $2 AND status = 'pending'`, [jobId, rowNo, msg]);
  }
}

async function ensureCategory(c: PoolClient, name: string, opt: ImportOptions): Promise<number> {
  const hit = await q1<{ id: number }>(`SELECT id FROM categories WHERE lower(name) = lower($1)`, [name], c);
  if (hit) return hit.id;
  if (!opt.createCategories) throw new AppError("VALIDATION", `Category “${name}” does not exist.`);
  const base = slugify(name); let slug = base;
  for (let i = 2; await q1(`SELECT 1 FROM categories WHERE slug = $1`, [slug], c); i++) slug = `${base}-${i}`;
  const row = await q1<{ id: number }>(`INSERT INTO categories (name, slug, kind, sort_order) VALUES ($1,$2,$3,100) RETURNING id`, [name, slug, KIND(name)], c);
  return row!.id;
}

async function updateProductFields(c: PoolClient, actor: Actor, productId: number, d: RowData, categoryId: number | undefined, cur?: VariantSnap) {
  const p = cur ?? (await q1<VariantSnap>(`SELECT p.common_name AS product_name, p.botanical_name, p.description, p.care_notes, c.name AS category FROM products p JOIN categories c ON c.id = p.category_id WHERE p.id = $1`, [productId], c))!;
  const sets: string[] = []; const vals: unknown[] = [productId];
  const set = (col: string, v: unknown) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
  if (d.name !== undefined && d.name !== p.product_name) set("common_name", d.name);
  if (d.botanical !== undefined && (d.botanical ?? "") !== p.botanical_name) set("botanical_name", d.botanical ?? "");
  if (d.description !== undefined && (d.description ?? "") !== p.description) set("description", d.description ?? "");
  if (d.care !== undefined && (d.care ?? "") !== p.care_notes) set("care_notes", d.care ?? "");
  if (categoryId !== undefined && d.category && d.category.toLowerCase() !== p.category.toLowerCase()) set("category_id", categoryId);
  if (!sets.length) return;
  await q(`UPDATE products SET ${sets.join(", ")}, updated_at = now() WHERE id = $1`, vals, c);
  if (d.name !== undefined && d.name !== p.product_name) {
    await q(`UPDATE variants SET relabel_needed = true, relabel_since = now() WHERE product_id = $1 AND archived_at IS NULL`, [productId], c);
  }
  void actor;
}

// ---------------------------------------------------------------------------
// Results report
// ---------------------------------------------------------------------------
export async function jobReport(actor: Actor, id: string, format: "csv" | "xlsx") {
  const job = await getJob(actor, id);
  const rows = await q<{ row_no: number; status: string; action: string | null; message: string; warnings: unknown; changes: Record<string, [unknown, unknown]>; data: RowData | null }>(
    `SELECT row_no, status, action, message, warnings, changes, data FROM import_rows WHERE job_id = $1 ORDER BY row_no`, [id]);
  const header = ["row", "sku", "product_name", "pot_size", "result", "action", "changes", "message", "warnings"];
  const RESULT: Record<string, string> = { ok: "imported", failed: "failed", skipped: "skipped", pending: "not processed yet", new: "not checked" };
  const body = rows.map((r) => [r.row_no, r.data?.sku ?? "", r.data?.name ?? "", r.data?.size ?? "", RESULT[r.status] ?? r.status, r.action ?? "",
    Object.entries(r.changes ?? {}).map(([k, [a, b]]) => `${k}: ${fmt(k, a)} → ${fmt(k, b)}`).join("; "), r.message,
    (Array.isArray(r.warnings) ? r.warnings.filter((w) => typeof w === "string") : []).join(" ")]);
  await audit(undefined, actor, "import.report", "import_job", id, { format });
  const base = `import-results-${job.fileName.replace(/\.[^.]+$/, "")}`;
  if (format === "csv") return { name: `${base}.csv`, type: "text/csv; charset=utf-8", body: Buffer.from(toCsv(header, body)) };
  return { name: `${base}.xlsx`, type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", body: await toXlsx([{ name: "Results", header, rows: body, numeric: ["row"], widths: [6, 16, 24, 14, 14, 10, 50, 60, 40] }]) };
}
function fmt(k: string, v: unknown) {
  if (v === null || v === undefined || v === "") return "—";
  if (k === "price" && typeof v === "number") return `R${(v / 100).toFixed(2)}`;
  return Array.isArray(v) ? v.join("|") : String(v);
}

export { getPool as _pool, FIELDS };
