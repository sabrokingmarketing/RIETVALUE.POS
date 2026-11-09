import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { hashPassword } from "better-auth/crypto";
import type { PoolClient } from "pg";
import { q, q1, tx } from "./db";
import { AppError, isUniqueViolation } from "./errors";
import { assertRole, type Actor, type Role } from "./session-types";
import { audit } from "./audit";

export const passwordSchema = z.string().min(10, "Use at least 10 characters").max(128, "Password is too long");

const newUserInput = z.object({
  name: z.string().trim().min(1, "Enter a name").max(60),
  email: z.string().trim().toLowerCase().email("Enter a valid e-mail address"),
  password: passwordSchema,
  role: z.enum(["owner", "cashier"]),
});
export type NewUserInput = z.input<typeof newUserInput>;

async function insertUser(c: PoolClient, data: z.output<typeof newUserInput>): Promise<string> {
  const id = randomUUID();
  try {
    await c.query("SAVEPOINT nu");
    await c.query(`INSERT INTO "user" (id, name, email, "emailVerified", role, active) VALUES ($1,$2,$3,true,$4,true)`,
      [id, data.name, data.email, data.role]);
    await c.query("RELEASE SAVEPOINT nu");
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT nu");
    if (isUniqueViolation(e)) throw new AppError("CONFLICT", "Someone already uses that e-mail address.");
    throw e;
  }
  await c.query(`INSERT INTO account (id, "accountId", "providerId", "userId", password) VALUES ($1,$2,'credential',$2,$3)`,
    [randomUUID(), id, await hashPassword(data.password)]);
  return id;
}

/** Initial owner setup: only allowed while there are no owners, and only with SETUP_TOKEN. */
export async function createInitialOwner(input: NewUserInput & { setupToken: string }): Promise<string> {
  const expected = process.env.SETUP_TOKEN;
  if (!expected || expected.length < 8 || input.setupToken !== expected) {
    throw new AppError("FORBIDDEN", "The setup code is not correct. Find SETUP_TOKEN in the server configuration.");
  }
  const p = newUserInput.safeParse({ ...input, role: "owner" });
  if (!p.success) throw new AppError("VALIDATION", p.error.issues[0].message);
  return tx(async (c) => {
    await c.query(`LOCK TABLE "user" IN SHARE ROW EXCLUSIVE MODE`);
    const owners = await q1<{ n: number }>(`SELECT count(*) AS n FROM "user" WHERE role = 'owner'`, [], c);
    if (owners!.n > 0) throw new AppError("CONFLICT", "Setup is already complete. Sign in instead.");
    const id = await insertUser(c, p.data);
    await audit(c, { id, name: p.data.name, email: p.data.email, role: "owner" }, "user.setup_owner", "user", id, { email: p.data.email });
    return id;
  });
}

export async function needsSetup(): Promise<boolean> {
  const r = await q1<{ n: number }>(`SELECT count(*) AS n FROM "user" WHERE role = 'owner'`);
  return r!.n === 0;
}

export async function createStaff(actor: Actor, input: NewUserInput): Promise<string> {
  assertRole(actor, ["owner"]);
  const p = newUserInput.safeParse(input);
  if (!p.success) throw new AppError("VALIDATION", p.error.issues[0].message);
  return tx(async (c) => {
    const id = await insertUser(c, p.data);
    await audit(c, actor, "user.create", "user", id, { email: p.data.email, role: p.data.role });
    return id;
  });
}

export async function listStaff(actor: Actor) {
  assertRole(actor, ["owner"]);
  return q<{ id: string; name: string; email: string; role: Role; active: boolean; createdAt: string; last_seen: string | null }>(
    `SELECT u.id, u.name, u.email, u.role, u.active, u."createdAt",
            (SELECT max(s."updatedAt") FROM session s WHERE s."userId" = u.id) AS last_seen
     FROM "user" u ORDER BY u.active DESC, u.role DESC, u.name`);
}

/** Deactivate / reactivate a staff member. Deactivation signs them out everywhere at once. */
export async function setStaffActive(actor: Actor, userId: string, active: boolean) {
  assertRole(actor, ["owner"]);
  if (userId === actor.id && !active) throw new AppError("VALIDATION", "You cannot deactivate your own account.");
  await tx(async (c) => {
    const u = await q1<{ role: Role }>(`UPDATE "user" SET active = $2, "updatedAt" = now() WHERE id = $1 RETURNING role`, [userId, active], c);
    if (!u) throw new AppError("NOT_FOUND", "Staff member not found");
    if (!active && u.role === "owner") {
      const others = await q1<{ n: number }>(`SELECT count(*) AS n FROM "user" WHERE role='owner' AND active`, [], c);
      if (others!.n === 0) throw new AppError("VALIDATION", "At least one owner must stay active.");
    }
    if (!active) await c.query(`DELETE FROM session WHERE "userId" = $1`, [userId]);
    await audit(c, actor, active ? "user.reactivate" : "user.deactivate", "user", userId, {});
  });
}

/** Owner sets a new password for a staff member (e.g. a cashier who forgot theirs). */
export async function setStaffPassword(actor: Actor | null, userId: string, password: string) {
  if (actor) assertRole(actor, ["owner"]);
  const p = passwordSchema.safeParse(password);
  if (!p.success) throw new AppError("VALIDATION", p.error.issues[0].message);
  await tx(async (c) => {
    const r = await q1(`UPDATE account SET password = $2, "updatedAt" = now() WHERE "userId" = $1 AND "providerId" = 'credential' RETURNING id`,
      [userId, await hashPassword(p.data)], c);
    if (!r) throw new AppError("NOT_FOUND", "Staff member not found");
    await c.query(`DELETE FROM session WHERE "userId" = $1`, [userId]);
    await audit(c, actor, "user.password_set", "user", userId, {});
  });
}
