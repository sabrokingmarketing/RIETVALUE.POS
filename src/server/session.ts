import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "./auth";
import { q1 } from "./db";
import { AppError } from "./errors";

import { assertRole, type Actor, type Role } from "./session-types";
export { assertRole, type Actor, type Role };

/** Resolve the signed-in, *active* staff member from the session cookie (server-side). */
export async function getActor(): Promise<Actor | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  // Always re-read role/active from the database: deactivation and role changes apply immediately.
  const u = await q1<{ id: string; name: string; email: string; role: Role; active: boolean }>(
    `SELECT id, name, email, role, active FROM "user" WHERE id = $1`,
    [session.user.id],
  );
  if (!u || !u.active) return null;
  return { id: u.id, name: u.name, email: u.email, role: u.role };
}

/** For pages: redirect to sign-in or show forbidden. */
export async function pageActor(roles: Role[] = ["owner", "cashier"], next = "/till"): Promise<Actor> {
  const actor = await getActor();
  if (!actor) redirect(`/login?next=${encodeURIComponent(next)}`);
  if (!roles.includes(actor.role)) redirect("/forbidden");
  return actor;
}

/** For actions and API routes: throw a typed error. */
export async function requireActor(roles: Role[] = ["owner", "cashier"]): Promise<Actor> {
  const actor = await getActor();
  if (!actor) throw new AppError("UNAUTHENTICATED", "Please sign in again.");
  assertRole(actor, roles);
  return actor;
}
