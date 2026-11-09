import { randomUUID } from "node:crypto";
import pg from "pg";
import { migrate } from "../../scripts/migrate";
import { getPool, q, q1 } from "@/server/db";
import type { Actor } from "@/server/session-types";
import { hashPassword } from "better-auth/crypto";

/** Drop everything and re-apply migrations on the dedicated test database. */
export async function resetDatabase() {
  const url = process.env.DATABASE_URL!;
  if (!/test/.test(url)) throw new Error("Refusing to reset a database whose URL does not contain 'test'");
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  await c.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await c.end();
  await migrate(url, () => {});
}

export async function makeUser(role: "owner" | "cashier", email = `${role}-${randomUUID().slice(0, 8)}@test.local`, password = "correct horse battery"): Promise<Actor> {
  const id = randomUUID();
  await q(`INSERT INTO "user" (id, name, email, "emailVerified", role, active) VALUES ($1,$2,$3,true,$4,true)`, [id, `Test ${role}`, email, role]);
  await q(`INSERT INTO account (id, "accountId", "providerId", "userId", password) VALUES ($1,$2,'credential',$2,$3)`,
    [randomUUID(), id, await hashPassword(password)]);
  return { id, name: `Test ${role}`, email, role };
}

export async function makeCategory(kind: "plant" | "pot" | "supply" = "plant") {
  const slug = `cat-${randomUUID().slice(0, 6)}`;
  return (await q1<{ id: number }>(`INSERT INTO categories (name, slug, kind) VALUES ($1,$1,$2) RETURNING id`, [slug, kind]))!.id;
}

export async function onHand(variantId: number) {
  return (await q1<{ on_hand: number }>(`SELECT on_hand FROM variants WHERE id = $1`, [variantId]))!.on_hand;
}

export async function closePool() {
  await getPool().end();
  globalThis.__nurseryPool = undefined;
}
