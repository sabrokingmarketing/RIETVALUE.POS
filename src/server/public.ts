import "server-only";
import { q } from "./db";

/**
 * Public catalogue access. Reads ONLY from the `public_catalogue` view, which
 * exposes published, active variants with a coarse availability label —
 * never stock counts, costs, staff or transactions.
 */
export type PublicVariant = { variant_id: number; size_label: string; price_cents: number; availability: "in_stock" | "limited" | "sold_out" };
export type PublicPlant = {
  product_id: number; slug: string; common_name: string; botanical_name: string; description: string; care_notes: string;
  photo_path: string | null; photo_is_fixture: boolean; category_name: string; category_slug: string; variants: PublicVariant[];
};

type Row = Omit<PublicPlant, "variants"> & PublicVariant & { category_sort: number };

function group(rows: Row[]): PublicPlant[] {
  const map = new Map<number, PublicPlant>();
  for (const r of rows) {
    let p = map.get(r.product_id);
    if (!p) {
      p = {
        product_id: r.product_id, slug: r.slug, common_name: r.common_name, botanical_name: r.botanical_name,
        description: r.description, care_notes: r.care_notes, photo_path: r.photo_path, photo_is_fixture: r.photo_is_fixture,
        category_name: r.category_name, category_slug: r.category_slug, variants: [],
      };
      map.set(r.product_id, p);
    }
    p.variants.push({ variant_id: r.variant_id, size_label: r.size_label, price_cents: r.price_cents, availability: r.availability });
  }
  return [...map.values()];
}

export async function publicCatalogue(opts: { category?: string; term?: string } = {}): Promise<PublicPlant[]> {
  const like = `%${(opts.term ?? "").trim().replace(/[\\%_]/g, (m) => "\\" + m)}%`;
  const rows = await q<Row>(
    `SELECT * FROM public_catalogue
     WHERE ($1::text IS NULL OR category_slug = $1) AND (common_name ILIKE $2 OR botanical_name ILIKE $2)
     ORDER BY common_name, price_cents`,
    [opts.category || null, like]);
  return group(rows);
}

export async function publicPlant(slug: string): Promise<PublicPlant | null> {
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return null;
  const rows = await q<Row>(`SELECT * FROM public_catalogue WHERE slug = $1 ORDER BY price_cents`, [slug]);
  return group(rows)[0] ?? null;
}

export async function publicCategories() {
  return q<{ name: string; slug: string }>(
    `SELECT DISTINCT category_name AS name, category_slug AS slug, category_sort FROM public_catalogue ORDER BY category_sort, name`);
}

export function availabilityText(a: PublicVariant["availability"]): string {
  return a === "in_stock" ? "In stock" : a === "limited" ? "Only a few left" : "Sold out";
}
