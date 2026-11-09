import "server-only";
import { z } from "zod";
import { boolish } from "@/lib/zod-helpers";
import type { PoolClient } from "pg";
import { q, q1, tx, type Db } from "./db";
import { AppError, isUniqueViolation } from "./errors";
import { assertRole, type Actor } from "./session-types";
import { audit } from "./audit";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type Category = { id: number; name: string; slug: string; kind: "plant" | "pot" | "supply"; sort_order: number };

export type VariantRow = {
  id: number;
  product_id: number;
  common_name: string;
  botanical_name: string;
  category_id: number;
  category_name: string;
  size_label: string;
  sku: string;
  barcode: string;
  price_cents: number;
  low_stock_threshold: number;
  is_public: boolean;
  on_hand: number;
  relabel_needed: boolean;
  archived: boolean;
  product_archived: boolean;
  photo_path: string | null;
};

const VARIANT_SELECT = `
  SELECT v.id, v.product_id, p.common_name, p.botanical_name, p.category_id, c.name AS category_name,
         v.size_label, v.sku, v.barcode, v.price_cents, v.low_stock_threshold, v.is_public, v.on_hand,
         v.relabel_needed, (v.archived_at IS NOT NULL) AS archived, (p.archived_at IS NOT NULL) AS product_archived,
         p.photo_path
  FROM variants v JOIN products p ON p.id = v.product_id JOIN categories c ON c.id = p.category_id`;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
const text = (max: number) => z.string().trim().max(max);
const SKU_RE = /^[A-Z0-9][A-Z0-9-]{1,31}$/;
/** Printable ASCII only, no spaces; leading zeros are preserved because codes are text. */
export const CODE_RE = /^[\x21-\x7E]{1,48}$/;

export const productInput = z.object({
  commonName: text(80).min(1, "Enter the plant or product name"),
  botanicalName: text(120).default(""),
  categoryId: z.coerce.number().int().positive("Choose a category"),
  description: text(2000).default(""),
  careNotes: text(2000).default(""),
});
export type ProductInput = z.input<typeof productInput>;

export const variantInput = z.object({
  sizeLabel: text(40).min(1, "Enter the pot or pack size, e.g. 15 cm pot"),
  sku: text(32).toUpperCase().default("")
    .refine((s) => s === "" || SKU_RE.test(s), "SKU may use letters, numbers and dashes (2–32 characters)"),
  priceCents: z.coerce.number().int().positive("Enter a selling price above R0").max(100_000_00, "Price is too high"),
  lowStockThreshold: z.coerce.number().int().min(0).max(10000).default(3),
  isPublic: boolish().default(false),
  aliasBarcode: text(48).default("").refine((s) => s === "" || CODE_RE.test(s), "Supplier barcode has invalid characters"),
  /** Optional existing barcode to use as this size's label code (e.g. from an import). Blank = generate one. */
  barcode: text(48).default("").refine((s) => s === "" || CODE_RE.test(s), "Barcode has invalid characters"),
});
export type VariantInput = z.input<typeof variantInput>;

function parse<T extends z.ZodTypeAny>(schema: T, input: unknown): z.output<T> {
  const r = schema.safeParse(input);
  if (!r.success) {
    const first = r.error.issues[0];
    throw new AppError("VALIDATION", first?.message || "Please check the form", r.error.flatten());
  }
  return r.data;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
export function slugify(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "item";
}

function skuBase(name: string, size: string): string {
  const n = name.toUpperCase().replace(/[^A-Z0-9 ]/g, "").split(/\s+/).filter(Boolean);
  const head = n.length > 1 ? n.map((w) => w.slice(0, 3)).join("").slice(0, 8) : (n[0] || "ITEM").slice(0, 8);
  const sz = size.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  return `${head}-${sz || "STD"}`.slice(0, 28);
}

async function uniqueSku(db: Db, base: string): Promise<string> {
  let candidate = base;
  for (let i = 2; i < 500; i++) {
    const hit = await q1(`SELECT 1 FROM variants WHERE sku = $1`, [candidate], db);
    if (!hit) return candidate;
    candidate = `${base}-${i}`;
  }
  throw new AppError("CONFLICT", "Could not generate a unique SKU; please enter one");
}

async function uniqueSlug(db: Db, base: string, exceptId?: number): Promise<string> {
  let candidate = base;
  for (let i = 2; i < 500; i++) {
    const hit = await q1<{ id: number }>(`SELECT id FROM products WHERE slug = $1`, [candidate], db);
    if (!hit || hit.id === exceptId) return candidate;
    candidate = `${base}-${i}`;
  }
  throw new AppError("CONFLICT", "Could not generate a unique web address");
}

/**
 * Allocate the next internal barcode: "21" + 6 digits (GS1 in-store prefix range),
 * numeric so Code 128 uses its compact C set. Comes from a never-reset sequence,
 * and skips any value already registered as a supplier alias, so no code is reused.
 */
async function allocateInternalCode(db: Db): Promise<string> {
  for (let i = 0; i < 100; i++) {
    const row = await q1<{ n: number }>(`SELECT nextval('internal_barcode_seq') AS n`, [], db);
    const code = `21${String(row!.n).padStart(6, "0")}`;
    const taken = await q1(`SELECT 1 FROM barcodes WHERE code = $1`, [code], db);
    if (!taken) return code;
  }
  throw new AppError("CONFLICT", "Could not allocate a barcode");
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------
/** Categories that have sellable items, with counts, for the POS chips. */
export async function posCategories(db?: Db) {
  return q<{ slug: string; name: string; count: number }>(
    `SELECT c.slug, c.name, count(v.id)::int AS count FROM categories c JOIN products p ON p.category_id = c.id AND p.archived_at IS NULL
     JOIN variants v ON v.product_id = p.id AND v.archived_at IS NULL GROUP BY c.id ORDER BY c.sort_order, c.name`, [], db);
}

export async function listCategories(db?: Db): Promise<Category[]> {
  return q<Category>(`SELECT id, name, slug, kind, sort_order FROM categories ORDER BY sort_order, name`, [], db);
}

export async function getVariant(id: number, db?: Db): Promise<VariantRow | undefined> {
  return q1<VariantRow>(`${VARIANT_SELECT} WHERE v.id = $1`, [id], db);
}

export async function getVariantsByIds(ids: number[], db?: Db): Promise<VariantRow[]> {
  if (ids.length === 0) return [];
  return q<VariantRow>(`${VARIANT_SELECT} WHERE v.id = ANY($1::int[]) ORDER BY p.common_name, v.size_label`, [ids], db);
}

/** Till lookup: exact barcode (internal or alias) to an active, sellable variant. */
export async function lookupCode(code: string, db?: Db): Promise<VariantRow | null> {
  const clean = code.trim();
  if (!CODE_RE.test(clean)) return null;
  const row = await q1<VariantRow>(
    `${VARIANT_SELECT} JOIN barcodes b ON b.variant_id = v.id
     WHERE b.code = $1 AND b.retired_at IS NULL`,
    [clean],
    db,
  );
  return row ?? null;
}

/** Search by name, botanical name, SKU or code, optionally within one category. Active items only unless includeArchived. */
export async function searchVariants(term: string, opts: { includeArchived?: boolean; limit?: number; category?: string } = {}, db?: Db) {
  const t = term.trim();
  const limit = Math.min(opts.limit ?? 20, 100);
  const like = `%${t.replace(/[\\%_]/g, (m) => "\\" + m)}%`;
  return q<VariantRow>(
    `${VARIANT_SELECT}
     WHERE ($4 OR (v.archived_at IS NULL AND p.archived_at IS NULL))
       AND ($5::text IS NULL OR c.slug = $5)
       AND ($2 = '' OR p.common_name ILIKE $1 OR p.botanical_name ILIKE $1 OR v.sku ILIKE $1 OR v.barcode = $2
            OR EXISTS (SELECT 1 FROM barcodes b WHERE b.variant_id = v.id AND b.code = $2))
     ORDER BY (v.sku = upper($2)) DESC, p.common_name, v.size_label LIMIT $3`,
    [like, t, limit, !!opts.includeArchived, opts.category || null],
    db,
  );
}

export type ProductDetail = {
  id: number; common_name: string; botanical_name: string; description: string; care_notes: string;
  category_id: number; slug: string; photo_path: string | null; photo_is_fixture: boolean; archived: boolean;
  variants: (VariantRow & { aliases: { code: string; retired: boolean }[] })[];
};

export async function getProduct(id: number, db?: Db): Promise<ProductDetail | null> {
  const p = await q1<Omit<ProductDetail, "variants">>(
    `SELECT id, common_name, botanical_name, description, care_notes, category_id, slug, photo_path,
            photo_is_fixture, (archived_at IS NOT NULL) AS archived FROM products WHERE id = $1`,
    [id],
    db,
  );
  if (!p) return null;
  const variants = await q<VariantRow>(`${VARIANT_SELECT} WHERE v.product_id = $1 ORDER BY v.archived_at NULLS FIRST, v.id`, [id], db);
  const aliases = await q<{ variant_id: number; code: string; retired: boolean }>(
    `SELECT variant_id, code, (retired_at IS NOT NULL) AS retired FROM barcodes
     WHERE kind = 'alias' AND variant_id = ANY($1::int[]) ORDER BY created_at`,
    [variants.map((v) => v.id)],
    db,
  );
  return {
    ...p,
    variants: variants.map((v) => ({ ...v, aliases: aliases.filter((a) => a.variant_id === v.id) })),
  };
}

export async function listProducts(opts: { term?: string; archived?: boolean } = {}, db?: Db) {
  const like = `%${(opts.term ?? "").trim()}%`;
  return q<{
    id: number; common_name: string; botanical_name: string; category_name: string; photo_path: string | null;
    archived: boolean; variant_count: number; public_count: number; on_hand: number; low: number; relabel: number;
  }>(
    `SELECT p.id, p.common_name, p.botanical_name, c.name AS category_name, p.photo_path,
            (p.archived_at IS NOT NULL) AS archived,
            count(v.id) FILTER (WHERE v.archived_at IS NULL) AS variant_count,
            count(v.id) FILTER (WHERE v.archived_at IS NULL AND v.is_public) AS public_count,
            coalesce(sum(v.on_hand) FILTER (WHERE v.archived_at IS NULL), 0) AS on_hand,
            count(v.id) FILTER (WHERE v.archived_at IS NULL AND v.on_hand <= v.low_stock_threshold) AS low,
            count(v.id) FILTER (WHERE v.archived_at IS NULL AND v.relabel_needed) AS relabel
     FROM products p JOIN categories c ON c.id = p.category_id
     LEFT JOIN variants v ON v.product_id = p.id
     WHERE (p.archived_at IS NOT NULL) = $2
       AND (p.common_name ILIKE $1 OR p.botanical_name ILIKE $1
            OR EXISTS (SELECT 1 FROM variants v2 WHERE v2.product_id = p.id AND (v2.sku ILIKE $1 OR v2.barcode = $3)))
     GROUP BY p.id, c.name ORDER BY p.common_name`,
    [like, opts.archived ?? false, (opts.term ?? "").trim()],
    db,
  );
}

// ---------------------------------------------------------------------------
// Mutations (owner only)
// ---------------------------------------------------------------------------
export async function createProduct(actor: Actor, input: ProductInput, db?: PoolClient): Promise<number> {
  assertRole(actor, ["owner"]);
  const data = parse(productInput, input);
  const run = async (c: PoolClient) => {
    const cat = await q1(`SELECT 1 FROM categories WHERE id = $1`, [data.categoryId], c);
    if (!cat) throw new AppError("VALIDATION", "Choose a category");
    const slug = await uniqueSlug(c, slugify(data.commonName));
    const row = await q1<{ id: number }>(
      `INSERT INTO products (common_name, botanical_name, category_id, description, care_notes, slug)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [data.commonName, data.botanicalName, data.categoryId, data.description, data.careNotes, slug],
      c,
    );
    await audit(c, actor, "product.create", "product", row!.id, data);
    return row!.id;
  };
  return db ? run(db) : tx(run);
}

export async function updateProduct(actor: Actor, id: number, input: ProductInput): Promise<void> {
  assertRole(actor, ["owner"]);
  const data = parse(productInput, input);
  await tx(async (c) => {
    const cur = await q1<{ common_name: string }>(`SELECT common_name FROM products WHERE id = $1 FOR UPDATE`, [id], c);
    if (!cur) throw new AppError("NOT_FOUND", "Product not found");
    await q(
      `UPDATE products SET common_name=$2, botanical_name=$3, category_id=$4, description=$5, care_notes=$6, updated_at=now()
       WHERE id=$1`,
      [id, data.commonName, data.botanicalName, data.categoryId, data.description, data.careNotes],
      c,
    );
    if (cur.common_name !== data.commonName) {
      // The name is printed on shelf labels — flag them for replacement.
      await q(`UPDATE variants SET relabel_needed = true, relabel_since = now() WHERE product_id = $1 AND archived_at IS NULL`, [id], c);
    }
    await audit(c, actor, "product.update", "product", id, data);
  });
}

export async function setProductPhoto(actor: Actor, id: number, photoPath: string | null): Promise<void> {
  assertRole(actor, ["owner"]);
  await q(`UPDATE products SET photo_path = $2, photo_is_fixture = false, updated_at = now() WHERE id = $1`, [id, photoPath]);
  await audit(undefined, actor, "product.photo", "product", id, { photoPath });
}

export async function createVariant(actor: Actor, productId: number, input: VariantInput, db?: PoolClient): Promise<number> {
  assertRole(actor, ["owner"]);
  const data = parse(variantInput, input);
  const run = async (c: PoolClient) => {
    const product = await q1<{ common_name: string; archived_at: Date | null }>(
      `SELECT common_name, archived_at FROM products WHERE id = $1 FOR UPDATE`, [productId], c);
    if (!product) throw new AppError("NOT_FOUND", "Product not found");
    const dupe = await q1(`SELECT 1 FROM variants WHERE product_id = $1 AND lower(size_label) = lower($2)`, [productId, data.sizeLabel], c);
    if (dupe) throw new AppError("CONFLICT", `“${data.sizeLabel}” already exists for this product`);
    const sku = data.sku || (await uniqueSku(c, skuBase(product.common_name, data.sizeLabel)));
    let code: string;
    if (data.barcode) {
      const taken = await q1(`SELECT 1 FROM barcodes WHERE code = $1`, [data.barcode], c);
      if (taken) throw new AppError("CONFLICT", `Barcode ${data.barcode} is already registered. Codes are never reused.`);
      code = data.barcode;
    } else code = await allocateInternalCode(c);
    let id: number;
    try {
      await c.query("SAVEPOINT v");
      const row = await q1<{ id: number }>(
        `INSERT INTO variants (product_id, size_label, sku, barcode, price_cents, low_stock_threshold, is_public)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [productId, data.sizeLabel, sku, code, data.priceCents, data.lowStockThreshold, data.isPublic],
        c,
      );
      id = row!.id;
      await c.query("RELEASE SAVEPOINT v");
    } catch (e) {
      await c.query("ROLLBACK TO SAVEPOINT v");
      if (isUniqueViolation(e, "variants_sku_key")) throw new AppError("CONFLICT", `SKU ${sku} is already used`);
      throw e;
    }
    await q(`INSERT INTO barcodes (code, variant_id, kind, created_by) VALUES ($1,$2,'internal',$3)`, [code, id, actor.id], c);
    if (data.aliasBarcode) await insertAlias(c, actor, id, data.aliasBarcode);
    await audit(c, actor, "variant.create", "variant", id, { ...data, sku, barcode: code });
    return id;
  };
  return db ? run(db) : tx(run);
}

async function insertAlias(c: Db, actor: Actor, variantId: number, code: string) {
  if (!CODE_RE.test(code)) throw new AppError("VALIDATION", "Supplier barcode has invalid characters");
  const existing = await q1<{ variant_id: number; kind: string }>(`SELECT variant_id, kind FROM barcodes WHERE code = $1`, [code], c);
  if (existing) {
    throw new AppError("CONFLICT", `Barcode ${code} is already registered${existing.kind === "internal" ? " as an internal code" : ""}. Codes are never reused.`);
  }
  await q(`INSERT INTO barcodes (code, variant_id, kind, created_by) VALUES ($1,$2,'alias',$3)`, [code, variantId, actor.id], c);
}

export async function addAlias(actor: Actor, variantId: number, code: string): Promise<void> {
  assertRole(actor, ["owner"]);
  const clean = code.trim();
  await tx(async (c) => {
    const v = await q1(`SELECT 1 FROM variants WHERE id = $1`, [variantId], c);
    if (!v) throw new AppError("NOT_FOUND", "Variant not found");
    try {
      await insertAlias(c, actor, variantId, clean);
    } catch (e) {
      if (isUniqueViolation(e)) throw new AppError("CONFLICT", `Barcode ${clean} is already registered`);
      throw e;
    }
    await audit(c, actor, "barcode.alias.add", "variant", variantId, { code: clean });
  });
}

/** Stop an alias from scanning. The code stays registered and can never be reused. */
export async function retireAlias(actor: Actor, code: string): Promise<void> {
  assertRole(actor, ["owner"]);
  await tx(async (c) => {
    const r = await q1<{ variant_id: number }>(
      `UPDATE barcodes SET retired_at = now() WHERE code = $1 AND kind = 'alias' AND retired_at IS NULL RETURNING variant_id`, [code], c);
    if (!r) throw new AppError("NOT_FOUND", "Alias not found");
    await audit(c, actor, "barcode.alias.retire", "variant", r.variant_id, { code });
  });
}

export const variantUpdateInput = variantInput.omit({ aliasBarcode: true, sku: true }).extend({
  sku: text(32).toUpperCase().refine((s) => SKU_RE.test(s), "SKU may use letters, numbers and dashes (2–32 characters)"),
});

export async function updateVariant(
  actor: Actor,
  id: number,
  input: z.input<typeof variantUpdateInput>,
  opts: { source?: "edit" | "receiving"; db?: PoolClient } = {},
): Promise<{ priceChanged: boolean }> {
  assertRole(actor, ["owner"]);
  const data = parse(variantUpdateInput, input);
  const run = async (c: PoolClient) => {
    const cur = await q1<{ price_cents: number; size_label: string; product_id: number; sku: string }>(
      `SELECT price_cents, size_label, product_id, sku FROM variants WHERE id = $1 FOR UPDATE`, [id], c);
    if (!cur) throw new AppError("NOT_FOUND", "Variant not found");
    const dupe = await q1(`SELECT 1 FROM variants WHERE product_id=$1 AND lower(size_label)=lower($2) AND id<>$3`,
      [cur.product_id, data.sizeLabel, id], c);
    if (dupe) throw new AppError("CONFLICT", `“${data.sizeLabel}” already exists for this product`);
    const priceChanged = cur.price_cents !== data.priceCents;
    const labelChanged = priceChanged || cur.size_label !== data.sizeLabel;
    try {
      await c.query("SAVEPOINT u");
      await q(
        `UPDATE variants SET size_label=$2, sku=$3, price_cents=$4, low_stock_threshold=$5, is_public=$6, updated_at=now(),
           relabel_needed = relabel_needed OR $7, relabel_since = CASE WHEN $7 THEN now() ELSE relabel_since END
         WHERE id=$1`,
        [id, data.sizeLabel, data.sku, data.priceCents, data.lowStockThreshold, data.isPublic, labelChanged],
        c,
      );
      await c.query("RELEASE SAVEPOINT u");
    } catch (e) {
      await c.query("ROLLBACK TO SAVEPOINT u");
      if (isUniqueViolation(e, "variants_sku_key")) throw new AppError("CONFLICT", `SKU ${data.sku} is already used`);
      throw e;
    }
    if (priceChanged) {
      await q(`INSERT INTO price_changes (variant_id, old_cents, new_cents, changed_by, source) VALUES ($1,$2,$3,$4,$5)`,
        [id, cur.price_cents, data.priceCents, actor.id, opts.source ?? "edit"], c);
    }
    await audit(c, actor, "variant.update", "variant", id, { ...data, previousPriceCents: cur.price_cents });
    return { priceChanged };
  };
  return opts.db ? run(opts.db) : tx(run);
}

/** Price-only change (used by receiving when staff confirm a new price). */
export async function setVariantPrice(actor: Actor, id: number, priceCents: number, source: "edit" | "receiving", c: PoolClient) {
  const v = await getVariant(id, c);
  if (!v) throw new AppError("NOT_FOUND", "Variant not found");
  if (v.price_cents === priceCents) return { priceChanged: false };
  return updateVariant(actor, id, {
    sizeLabel: v.size_label, sku: v.sku, priceCents, lowStockThreshold: v.low_stock_threshold, isPublic: v.is_public,
  }, { source, db: c });
}

export async function setVariantArchived(actor: Actor, id: number, archived: boolean): Promise<void> {
  assertRole(actor, ["owner"]);
  await tx(async (c) => {
    const r = await q1(`UPDATE variants SET archived_at = CASE WHEN $2 THEN now() ELSE NULL END, updated_at = now()
                        WHERE id = $1 RETURNING id`, [id, archived], c);
    if (!r) throw new AppError("NOT_FOUND", "Variant not found");
    await audit(c, actor, archived ? "variant.archive" : "variant.restore", "variant", id, {});
  });
}

export async function setProductArchived(actor: Actor, id: number, archived: boolean): Promise<void> {
  assertRole(actor, ["owner"]);
  await tx(async (c) => {
    const r = await q1(`UPDATE products SET archived_at = CASE WHEN $2 THEN now() ELSE NULL END, updated_at = now()
                        WHERE id = $1 RETURNING id`, [id, archived], c);
    if (!r) throw new AppError("NOT_FOUND", "Product not found");
    await audit(c, actor, archived ? "product.archive" : "product.restore", "product", id, {});
  });
}

// ---------------------------------------------------------------------------
// Relabel queue (any staff member can acknowledge that new labels are on the shelf)
// ---------------------------------------------------------------------------
export async function relabelQueue(db?: Db) {
  return q<VariantRow & { relabel_since: string; old_cents: number | null }>(
    `${VARIANT_SELECT.replace("p.photo_path", "p.photo_path, v.relabel_since,\n (SELECT pc.old_cents FROM price_changes pc WHERE pc.variant_id = v.id AND pc.changed_at >= v.relabel_since ORDER BY pc.changed_at LIMIT 1) AS old_cents")}
     WHERE v.relabel_needed AND v.archived_at IS NULL ORDER BY v.relabel_since`,
    [],
    db,
  );
}

export async function acknowledgeRelabel(actor: Actor, variantIds: number[]): Promise<number> {
  assertRole(actor, ["owner", "cashier"]);
  if (variantIds.length === 0) return 0;
  return tx(async (c) => {
    const rows = await q<{ id: number }>(
      `UPDATE variants SET relabel_needed = false, relabel_since = NULL WHERE id = ANY($1::int[]) AND relabel_needed RETURNING id`,
      [variantIds], c);
    for (const r of rows) await audit(c, actor, "variant.relabelled", "variant", r.id, {});
    return rows.length;
  });
}
