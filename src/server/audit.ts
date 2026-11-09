import "server-only";
import { q, type Db } from "./db";
import type { Actor } from "./session-types";

export async function audit(
  db: Db | undefined, actor: Actor | null, action: string, entity: string, entityId: string | number, detail: unknown,
) {
  await q(`INSERT INTO audit_log (actor_id, action, entity, entity_id, detail) VALUES ($1,$2,$3,$4,$5)`,
    [actor?.id ?? null, action, entity, String(entityId), JSON.stringify(detail ?? {})], db);
}
