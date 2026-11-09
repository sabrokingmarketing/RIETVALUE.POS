import { AppError } from "./errors";

export type Role = "owner" | "cashier";
export type Actor = { id: string; name: string; email: string; role: Role };

export function assertRole(actor: Actor | null | undefined, roles: Role[]): asserts actor is Actor {
  if (!actor) throw new AppError("UNAUTHENTICATED", "Please sign in again.");
  if (!roles.includes(actor.role)) {
    throw new AppError("FORBIDDEN", "Only the owner can do this. Ask the owner to sign in.");
  }
}
