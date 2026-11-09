/**
 * DEVELOPMENT SEED — demo accounts, placeholder business details and sample stock.
 * Refuses to run when NODE_ENV=production. Never run this against the live database.
 */
import { randomUUID } from "node:crypto";
import { getPool, q, q1 } from "../src/server/db";
import { createProduct, createVariant } from "../src/server/catalog";
import { receiveDelivery } from "../src/server/stock";
import type { Actor } from "../src/server/session-types";
import { hashPassword } from "better-auth/crypto";

export const DEMO = {
  owner: { email: "owner@demo.test", password: "demo-owner-pass", name: "Demo Owner" },
  cashier: { email: "cashier@demo.test", password: "demo-cashier-pass", name: "Demo Cashier" },
};

async function ensureUser(u: { email: string; password: string; name: string }, role: "owner" | "cashier"): Promise<Actor> {
  const existing = await q1<{ id: string }>(`SELECT id FROM "user" WHERE email = $1`, [u.email]);
  if (existing) return { id: existing.id, name: u.name, email: u.email, role };
  const id = randomUUID();
  await q(`INSERT INTO "user" (id, name, email, "emailVerified", role, active) VALUES ($1,$2,$3,true,$4,true)`, [id, u.name, u.email, role]);
  await q(`INSERT INTO account (id, "accountId", "providerId", "userId", password) VALUES ($1,$2,'credential',$2,$3)`,
    [randomUUID(), id, await hashPassword(u.password)]);
  return { id, name: u.name, email: u.email, role };
}

export async function seed(opts: { withStock?: boolean; log?: (s: string) => void } = {}) {
  const log = opts.log ?? console.log;
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed demo data with NODE_ENV=production");

  const owner = await ensureUser(DEMO.owner, "owner");
  await ensureUser(DEMO.cashier, "cashier");

  await q(`UPDATE settings SET
    business_name = 'Demo Nursery (development fixture)', legal_name = 'DEVELOPMENT FIXTURE — not a real business',
    tagline = 'Waterwise, indigenous and everyday garden plants',
    vat_registered = true, vat_number = '4000000000', vat_rate_bp = 1500,
    address_lines = E'FIXTURE ADDRESS — replace before launch\\n1 Example Road\\nExample Town, 0000',
    phone = '000 000 0000', whatsapp_number = '27000000000', email = 'hello@demo.test',
    opening_hours = E'Monday – Friday: 08:00 – 17:00\\nSaturday: 08:00 – 15:00\\nSunday & public holidays: 09:00 – 13:00',
    map_url = '', directions = 'FIXTURE — add real directions in Settings before launch.',
    about_text = E'This text is a development placeholder. Replace it in Settings with the nursery''s own story.\\n\\nWe grow and sell plants suited to South African gardens, from waterwise indigenous shrubs to herbs and houseplants.',
    receipt_footer = 'Thank you for supporting a local nursery. Returns within 7 days with this receipt.',
    is_fixture = true WHERE id = 1`);

  const cats = [
    ["Herbs & lavender", "herbs-lavender", "plant", 1], ["Indigenous", "indigenous", "plant", 2], ["Succulents & aloes", "succulents-aloes", "plant", 3],
    ["Indoor plants", "indoor", "plant", 4], ["Roses", "roses", "plant", 5], ["Pots", "pots", "pot", 6], ["Garden supplies", "supplies", "supply", 7],
  ] as const;
  for (const [name, slug, kind, sort] of cats) {
    await q(`INSERT INTO categories (name, slug, kind, sort_order) VALUES ($1,$2,$3,$4) ON CONFLICT (slug) DO NOTHING`, [name, slug, kind, sort]);
  }
  const catId = async (slug: string) => (await q1<{ id: number }>(`SELECT id FROM categories WHERE slug = $1`, [slug]))!.id;

  const existing = await q1<{ n: number }>(`SELECT count(*) AS n FROM products`);
  if (existing!.n > 0) { log("Products already present; skipping catalogue seed."); return; }

  type V = { size: string; price: number; qty: number; public?: boolean; low?: number };
  const plants: { name: string; bot: string; cat: string; art: string; desc: string; care: string; variants: V[] }[] = [
    { name: "Lavender", bot: "Lavandula angustifolia", cat: "herbs-lavender", art: "lavender",
      desc: "Fragrant, silver-leaved and loved by bees. Flowers from spring into summer.", care: "Full sun, well-drained soil. Water deeply but infrequently.",
      variants: [{ size: "15 cm pot", price: 8990, qty: 0 }, { size: "20 cm pot", price: 14990, qty: 6 }] },
    { name: "Wild Garlic", bot: "Tulbaghia violacea", cat: "indigenous", art: "fern",
      desc: "Tough indigenous perennial with mauve flowers most of the year.", care: "Sun to light shade. Very waterwise once established.",
      variants: [{ size: "15 cm pot", price: 5490, qty: 24 }, { size: "4 L bag", price: 9990, qty: 2, low: 4 }] },
    { name: "Bird of Paradise", bot: "Strelitzia reginae", cat: "indigenous", art: "strelitzia",
      desc: "South Africa's iconic crane flower — bold leaves and orange-blue blooms.", care: "Full sun to semi-shade. Feed in spring and summer.",
      variants: [{ size: "20 cm pot", price: 18990, qty: 5 }, { size: "10 L bag", price: 34990, qty: 1, low: 2 }] },
    { name: "Fan Aloe", bot: "Kumara plicatilis", cat: "succulents-aloes", art: "aloe",
      desc: "Sculptural fan-shaped leaves; a slow-growing Western Cape treasure.", care: "Full sun, very well-drained soil. Water sparingly in summer.",
      variants: [{ size: "15 cm pot", price: 12990, qty: 8 }] },
    { name: "Echeveria Mix", bot: "Echeveria spp.", cat: "succulents-aloes", art: "succulent",
      desc: "Rosette succulents in soft greens and blues. Perfect for containers.", care: "Bright light, gritty mix. Let soil dry between watering.",
      variants: [{ size: "8 cm pot", price: 3490, qty: 40 }, { size: "6-pack", price: 18990, qty: 4 }] },
    { name: "Swiss Cheese Plant", bot: "Monstera deliciosa", cat: "indoor", art: "monstera",
      desc: "Easy, fast-growing houseplant with split leaves.", care: "Bright indirect light. Water when the top 3 cm of soil is dry.",
      variants: [{ size: "17 cm pot", price: 21990, qty: 3 }] },
    { name: "Iceberg Rose", bot: "Rosa 'Iceberg'", cat: "roses", art: "rose",
      desc: "Reliable floribunda rose with generous clusters of blooms.", care: "Full sun, rich soil, regular feeding and deep watering.",
      variants: [{ size: "10 L bag", price: 24990, qty: 7 }] },
    { name: "Terracotta Pot", bot: "", cat: "pots", art: "potonly",
      desc: "Classic unglazed terracotta.", care: "Soak before planting.",
      variants: [{ size: "15 cm", price: 4990, qty: 30 }, { size: "25 cm", price: 11990, qty: 12 }] },
    { name: "Potting Soil", bot: "", cat: "supplies", art: "compost",
      desc: "General-purpose potting mix.", care: "",
      variants: [{ size: "30 dm³ bag", price: 6990, qty: 20, public: false }] },
  ];

  const lines: { variantId: number; quantity: number; priceCents: number }[] = [];
  for (const p of plants) {
    const pid = await createProduct(owner, { commonName: p.name, botanicalName: p.bot, categoryId: await catId(p.cat), description: p.desc, careNotes: p.care });
    await q(`UPDATE products SET photo_path = $2, photo_is_fixture = true WHERE id = $1`, [pid, `/fixtures/${p.art}.svg`]);
    for (const v of p.variants) {
      const vid = await createVariant(owner, pid, { sizeLabel: v.size, priceCents: v.price, lowStockThreshold: v.low ?? 3, isPublic: v.public ?? true });
      if (opts.withStock !== false && v.qty > 0) lines.push({ variantId: vid, quantity: v.qty, priceCents: v.price });
    }
  }
  if (lines.length) {
    const d = await receiveDelivery(owner, { idempotencyKey: randomUUID(), supplier: "Opening stock (fixture)", lines });
    log(`Opening stock received as ${d.deliveryNo}.`);
  }
  log(`Seeded ${plants.length} products. Demo sign-in: ${DEMO.owner.email} / ${DEMO.owner.password}, ${DEMO.cashier.email} / ${DEMO.cashier.password}`);
}

if (process.argv[1]?.endsWith("seed.ts")) {
  seed().then(() => getPool().end()).catch(async (e) => { console.error(e); await getPool().end(); process.exit(1); });
}
