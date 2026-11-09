import { randomUUID } from "node:crypto";
import pg from "pg";
import { hashPassword } from "better-auth/crypto";
import { migrate } from "../../scripts/migrate";
import { E2E_DB } from "../../playwright.config";
import { USERS } from "./fixtures";

/** Fresh e2e database: schema, two staff accounts, one category and VAT settings. No products — tests create them through the UI. */
export default async function globalSetup() {
  const c = new pg.Client({ connectionString: E2E_DB });
  await c.connect();
  await c.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await c.end();
  await migrate(E2E_DB, () => {});
  const db = new pg.Client({ connectionString: E2E_DB });
  await db.connect();
  for (const u of Object.values(USERS)) {
    const id = randomUUID();
    await db.query(`INSERT INTO "user" (id, name, email, "emailVerified", role, active) VALUES ($1,$2,$3,true,$4,true)`, [id, u.name, u.email, u.role]);
    await db.query(`INSERT INTO account (id, "accountId", "providerId", "userId", password) VALUES ($1,$2,'credential',$2,$3)`, [randomUUID(), id, await hashPassword(u.password)]);
  }
  await db.query(`INSERT INTO categories (name, slug, kind, sort_order) VALUES ('Herbs & lavender','herbs-lavender','plant',1), ('Pots','pots','pot',2)`);
  await db.query(`UPDATE settings SET business_name='E2E Test Nursery', vat_registered=true, vat_number='4123456789', vat_rate_bp=1500,
    whatsapp_number='27000000000', is_fixture=true, address_lines='Test address', opening_hours='Mon–Sat 08:00–17:00' WHERE id=1`);
  await db.end();
}
