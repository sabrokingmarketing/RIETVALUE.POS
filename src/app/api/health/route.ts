import { NextResponse } from "next/server";
import { q1 } from "@/server/db";

export const dynamic = "force-dynamic";

/** Liveness + readiness: 200 when the database answers. Extra details are best-effort. */
export async function GET() {
  try {
    await q1(`SELECT 1`);
  } catch {
    return NextResponse.json({ ok: false, error: "database unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const details = await q1<{ stalled: number; migration: string }>(
    `SELECT (SELECT count(*)::int FROM import_jobs WHERE status = 'running' AND heartbeat_at < now() - interval '5 minutes') AS stalled,
            (SELECT max(version) FROM schema_migrations) AS migration`).catch(() => undefined);
  return NextResponse.json({ ok: true, time: new Date().toISOString(), migration: details?.migration ?? null, stalledImports: details?.stalled ?? null },
    { headers: { "Cache-Control": "no-store" } });
}
