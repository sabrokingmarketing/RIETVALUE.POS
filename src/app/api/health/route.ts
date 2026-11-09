import { NextResponse } from "next/server";
import { q1 } from "@/server/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await q1(`SELECT 1`);
    return NextResponse.json({ ok: true, time: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, error: "database unavailable" }, { status: 503 });
  }
}
