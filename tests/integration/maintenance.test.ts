import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePool, makeUser, resetDatabase } from "../support/db";
import { seed, DEMO } from "../../scripts/seed";
import { q, q1 } from "@/server/db";
import { commitSale } from "@/server/checkout";
import { openTill } from "@/server/till";
import { executePurge, planPurge } from "@/server/maintenance";
import { ledgerMismatches } from "@/server/stock";
import type { Actor } from "@/server/session-types";

const cashierActor = async (): Promise<Actor> => {
  const u = await q1<{ id: string }>(`SELECT id FROM "user" WHERE email = $1`, [DEMO.cashier.email]);
  return { id: u!.id, name: "Demo Cashier", email: DEMO.cashier.email, role: "cashier" };
};

describe("removing development fixtures before launch", () => {
  beforeAll(async () => {
    await resetDatabase();
    await seed({ log: () => {} });
    const cashier = await cashierActor();
    await openTill(cashier, { floatCents: 0 });
    const v = await q1<{ id: number; price_cents: number }>(`SELECT id, price_cents FROM variants WHERE on_hand > 0 LIMIT 1`);
    await commitSale(cashier, { idempotencyKey: randomUUID(), lines: [{ variantId: v!.id, quantity: 1, unitPriceCents: v!.price_cents }], payment: { method: "cash", tenderedCents: v!.price_cents } });
  });
  afterAll(closePool);

  it("is blocked until a real owner exists", async () => {
    expect((await planPurge(true)).blocked).toMatch(/real owner account first/);
  });

  it("dry run lists demo data; confirm removes demo accounts, test sales and the fixture catalogue", async () => {
    await makeUser("owner", "real.owner@nursery.co.za");
    const plan = await planPurge(true);
    expect(plan.blocked).toBeNull();
    expect(plan.demoUsers.sort()).toEqual([DEMO.cashier.email, DEMO.owner.email].sort());
    expect(plan.demoSales).toBe(1);
    expect(plan.fixtureProducts).toBeGreaterThan(0);
    await executePurge(true);
    const left = await q1<{ users: number; sales: number; products: number; movements: number; counter: number }>(
      `SELECT (SELECT count(*)::int FROM "user" WHERE email LIKE '%@demo.test') AS users, (SELECT count(*)::int FROM sales) AS sales,
              (SELECT count(*)::int FROM products) AS products, (SELECT count(*)::int FROM stock_movements) AS movements,
              (SELECT value::int FROM counters WHERE name = 'sale') AS counter`);
    expect(left).toEqual({ users: 0, sales: 0, products: 0, movements: 0, counter: 0 });
    expect(await ledgerMismatches()).toEqual([]);
    // Immutability is back in force afterwards
    await expect(q(`DELETE FROM barcodes`)).resolves.toBeDefined();
    const triggers = await q<{ tgenabled: string }>(`SELECT tgenabled FROM pg_trigger WHERE tgname = 'sales_immutable'`);
    expect(triggers[0].tgenabled).toBe("O");
  });

  it("refuses when real staff have made sales", async () => {
    const owner = (await q1<{ id: string }>(`SELECT id FROM "user" WHERE email = 'real.owner@nursery.co.za'`))!;
    const actor: Actor = { id: owner.id, name: "Real", email: "real.owner@nursery.co.za", role: "owner" };
    const cat = (await q1<{ id: number }>(`INSERT INTO categories (name, slug, kind) VALUES ('Live','live','plant') RETURNING id`))!.id;
    const p = (await q1<{ id: number }>(`INSERT INTO products (common_name, category_id, slug) VALUES ('Real plant', $1, 'real-plant') RETURNING id`, [cat]))!.id;
    const v = (await q1<{ id: number }>(`INSERT INTO variants (product_id, size_label, sku, barcode, price_cents, on_hand) VALUES ($1,'15 cm','REAL-1','29999999',1000,0) RETURNING id`, [p]))!.id;
    await q(`INSERT INTO stock_movements (variant_id, quantity, balance_after, reason, operator_id, source_type, source_ref) VALUES ($1,1,1,'receive',$2,'delivery','X')`, [v, owner.id]);
    await q(`UPDATE variants SET on_hand = 1 WHERE id = $1`, [v]);
    await openTill(actor, { floatCents: 0 }).catch(() => undefined);
    await commitSale(actor, { idempotencyKey: randomUUID(), lines: [{ variantId: v, quantity: 1, unitPriceCents: 1000 }], payment: { method: "cash", tenderedCents: 1000 } });
    expect((await planPurge(false)).blocked).toMatch(/live records/);
    await expect(executePurge(false)).rejects.toThrow(/live records/);
    expect((await q1<{ n: number }>(`SELECT count(*)::int AS n FROM sales`))!.n).toBe(1);
  });
});
