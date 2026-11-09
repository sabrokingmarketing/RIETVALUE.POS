import "server-only";
import { NextResponse } from "next/server";
import { unstable_rethrow } from "next/navigation";
import { AppError, isAppError } from "./errors";
import { log } from "./log";

/** Reject cross-site state-changing requests (CSRF defence in addition to SameSite=Lax cookies). */
export function assertSameOrigin(req: Request) {
  if (req.method === "GET" || req.method === "HEAD") return;
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const allowed = new Set<string>();
  if (process.env.APP_URL) allowed.add(new URL(process.env.APP_URL).host);
  if (host) allowed.add(host);
  if (!origin) throw new AppError("FORBIDDEN", "Missing request origin");
  let originHost: string;
  try { originHost = new URL(origin).host; } catch { throw new AppError("FORBIDDEN", "Bad request origin"); }
  if (!allowed.has(originHost)) throw new AppError("FORBIDDEN", "Cross-site request refused");
}

export function errorResponse(e: unknown) {
  if (isAppError(e)) {
    return NextResponse.json({ error: { code: e.code, message: e.message, details: e.details ?? null } }, { status: e.status, headers: { "Cache-Control": "no-store" } });
  }
  log("error", "api.unexpected", {}, e);
  return NextResponse.json({ error: { code: "SERVER", message: "Something went wrong on the server. Please try again." } }, { status: 500 });
}

export function api<C>(fn: (req: Request, ctx: C) => Promise<Response | unknown>) {
  return async (req: Request, ctx: C) => {
    try {
      assertSameOrigin(req);
      const out = await fn(req, ctx);
      if (out instanceof Response) return out;
      return NextResponse.json(out ?? { ok: true }, { headers: { "Cache-Control": "no-store" } });
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export async function readJson(req: Request): Promise<unknown> {
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > 256_000) throw new AppError("VALIDATION", "Request too large");
  try { return await req.json(); } catch { throw new AppError("VALIDATION", "Invalid request body"); }
}

export type ActionState<T = unknown> = { ok: true; message?: string; data?: T } | { ok: false; error: string; details?: unknown } | null;

/** Wrap a server action body: AppErrors become form state; redirects and other Next control flow pass through. */
export async function runAction<T>(fn: () => Promise<T>, message?: string): Promise<ActionState<T>> {
  try {
    const data = await fn();
    return { ok: true, message, data };
  } catch (e) {
    unstable_rethrow(e);
    if (isAppError(e)) return { ok: false, error: e.message, details: e.details };
    log("error", "action.unexpected", {}, e);
    return { ok: false, error: "Something went wrong on the server. Please try again." };
  }
}
