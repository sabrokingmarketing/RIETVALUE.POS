import "server-only";
import type { PoolClient } from "pg";
import { q, q1, tx } from "./db";

export type PurgePlan = {
  demoUsers: string[];
  realSales: number;          // sales made by non-demo staff (never purged)
  demoSales: number; returns: number; movements: number; deliveries: number; tills: number; labelJobs: number; importJobs: number;
  fixtureProducts: number;
  blocked: string | null;
};

const DEMO_EMAIL = "%@demo.test";

/**
 * Plan the removal of development fixtures before going live: demo accounts, their test
 * transactions, and (optionally) the placeholder catalogue. Refuses if any sale or stock
 * movement was made by real staff, so live business records can never be deleted by this.
 */
export async function planPurge(includeCatalogue: boolean): Promise<PurgePlan> {
  const demoUsers = (await q<{ email: string }>(`SELECT email FROM "user" WHERE email LIKE $1`, [DEMO_EMAIL])).map((u) => u.email);
  const n = async (sql: string) => (await q1<{ n: number }>(sql, [DEMO_EMAIL]))!.n;
  const plan: PurgePlan = {
    demoUsers,
    realSales: await n(`SELECT count(*)::int AS n FROM sales s JOIN "user" u ON u.id = s.cashier_id WHERE u.email NOT LIKE $1`),
    demoSales: await n(`SELECT count(*)::int AS n FROM sales s JOIN "user" u ON u.id = s.cashier_id WHERE u.email LIKE $1`),
    returns: await n(`SELECT count(*)::int AS n FROM returns r JOIN "user" u ON u.id = r.processed_by WHERE u.email LIKE $1`),
    movements: await n(`SELECT count(*)::int AS n FROM stock_movements m JOIN "user" u ON u.id = m.operator_id WHERE u.email LIKE $1`),
    deliveries: await n(`SELECT count(*)::int AS n FROM deliveries d JOIN "user" u ON u.id = d.received_by WHERE u.email LIKE $1`),
    tills: await n(`SELECT count(*)::int AS n FROM till_sessions t JOIN "user" u ON u.id = t.opened_by WHERE u.email LIKE $1`),
    labelJobs: await n(`SELECT count(*)::int AS n FROM label_print_jobs j JOIN "user" u ON u.id = j.created_by WHERE u.email LIKE $1`),
    importJobs: await n(`SELECT count(*)::int AS n FROM import_jobs j JOIN "user" u ON u.id = j.created_by WHERE u.email LIKE $1`),
    fixtureProducts: includeCatalogue ? (await q1<{ n: number }>(`SELECT count(*)::int AS n FROM products WHERE photo_is_fixture`))!.n : 0,
    blocked: null,
  };
  const realMoves = await n(`SELECT count(*)::int AS n FROM stock_movements m JOIN "user" u ON u.id = m.operator_id WHERE u.email NOT LIKE $1`);
  const realOwner = await q1(`SELECT 1 FROM "user" WHERE role = 'owner' AND active AND email NOT LIKE $1`, [DEMO_EMAIL]);
  if (!realOwner) plan.blocked = "Create the real owner account first (Settings → Staff → Add, role Owner), then run this again.";
  else if (plan.realSales > 0) plan.blocked = `${plan.realSales} sale(s) were made by real staff accounts. This database holds live records — nothing will be purged. Restore a pre-launch backup instead if needed.`;
  else if (includeCatalogue && realMoves > 0) plan.blocked = `Real staff have already moved stock (${realMoves} movement(s)). The catalogue will not be purged; run without --catalogue to remove only demo accounts and their transactions.`;
  return plan;
}

async function withTriggersOff(c: PoolClient, tables: string[], fn: () => Promise<void>) {
  for (const t of tables) await c.query(`ALTER TABLE ${t} DISABLE TRIGGER USER`);
  await fn();
  for (const t of tables) await c.query(`ALTER TABLE ${t} ENABLE TRIGGER USER`);
}

/** Execute the plan in one transaction. Immutability triggers are suspended only inside it. */
export async function executePurge(includeCatalogue: boolean): Promise<PurgePlan> {
  const plan = await planPurge(includeCatalogue);
  if (plan.blocked) throw new Error(plan.blocked);
  await tx(async (c) => {
    const demo = `SELECT id FROM "user" WHERE email LIKE '${DEMO_EMAIL}'`;
    await withTriggersOff(c, ["sales", "sale_lines", "payments", "returns", "return_lines", "stock_movements"], async () => {
      await c.query(`DELETE FROM payments WHERE return_id IN (SELECT id FROM returns WHERE processed_by IN (${demo})) OR sale_id IN (SELECT id FROM sales WHERE cashier_id IN (${demo}))`);
      await c.query(`DELETE FROM return_lines WHERE return_id IN (SELECT id FROM returns WHERE processed_by IN (${demo}))`);
      await c.query(`DELETE FROM returns WHERE processed_by IN (${demo})`);
      await c.query(`DELETE FROM sale_lines WHERE sale_id IN (SELECT id FROM sales WHERE cashier_id IN (${demo}))`);
      await c.query(`DELETE FROM sales WHERE cashier_id IN (${demo})`);
      await c.query(`DELETE FROM declined_card_attempts WHERE cashier_id IN (${demo})`);
      // Undo demo stock movements so on-hand matches the remaining ledger.
      await c.query(`UPDATE variants v SET on_hand = on_hand - coalesce((SELECT sum(quantity) FROM stock_movements m WHERE m.variant_id = v.id AND m.operator_id IN (${demo})), 0)`);
      await c.query(`DELETE FROM stock_movements WHERE operator_id IN (${demo})`);
    });
    await c.query(`DELETE FROM delivery_lines WHERE delivery_id IN (SELECT id FROM deliveries WHERE received_by IN (${demo}))`);
    await c.query(`DELETE FROM label_print_jobs WHERE created_by IN (${demo}) OR delivery_id IN (SELECT id FROM deliveries WHERE received_by IN (${demo}))`);
    await c.query(`DELETE FROM deliveries WHERE received_by IN (${demo})`);
    await c.query(`DELETE FROM till_sessions WHERE opened_by IN (${demo})`);
    await c.query(`DELETE FROM import_jobs WHERE created_by IN (${demo})`);
    if (includeCatalogue) {
      await c.query(`DROP RULE barcodes_no_delete ON barcodes`);
      await c.query(`DELETE FROM import_rows WHERE variant_id IN (SELECT v.id FROM variants v JOIN products p ON p.id = v.product_id WHERE p.photo_is_fixture) OR product_id IN (SELECT id FROM products WHERE photo_is_fixture)`);
      await c.query(`DELETE FROM barcodes WHERE variant_id IN (SELECT v.id FROM variants v JOIN products p ON p.id = v.product_id WHERE p.photo_is_fixture)`);
      await c.query(`DELETE FROM price_changes WHERE variant_id IN (SELECT v.id FROM variants v JOIN products p ON p.id = v.product_id WHERE p.photo_is_fixture)`);
      await c.query(`DELETE FROM variants WHERE product_id IN (SELECT id FROM products WHERE photo_is_fixture)`);
      await c.query(`DELETE FROM products WHERE photo_is_fixture`);
      await c.query(`CREATE RULE barcodes_no_delete AS ON DELETE TO barcodes DO INSTEAD NOTHING`);
    } else {
      await c.query(`UPDATE price_changes SET changed_by = (SELECT id FROM "user" WHERE role = 'owner' AND email NOT LIKE '${DEMO_EMAIL}' ORDER BY "createdAt" LIMIT 1) WHERE changed_by IN (${demo})`);
    }
    await c.query(`UPDATE barcodes SET created_by = NULL WHERE created_by IN (${demo})`);
    await c.query(`UPDATE settings SET updated_by = NULL WHERE updated_by IN (${demo})`);
    await c.query(`UPDATE audit_log SET actor_id = NULL WHERE actor_id IN (${demo})`);
    await c.query(`DELETE FROM session WHERE "userId" IN (${demo})`);
    await c.query(`DELETE FROM account WHERE "userId" IN (${demo})`);
    await c.query(`DELETE FROM "user" WHERE email LIKE '${DEMO_EMAIL}'`);
    // Receipt numbers start again from 1 when no sales remain.
    await c.query(`UPDATE counters SET value = 0 WHERE name IN ('sale','return','delivery') AND NOT EXISTS (SELECT 1 FROM sales)`);
    await c.query(`INSERT INTO audit_log (actor_id, action, entity, entity_id, detail) VALUES (NULL, 'maintenance.purge_demo', 'database', 'all', $1)`, [JSON.stringify(plan)]);
  });
  return plan;
}
