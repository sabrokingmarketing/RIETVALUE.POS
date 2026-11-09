import { api, readJson } from "@/server/http";
import { requireActor } from "@/server/session";
import { cancelJob, getJob, listRows, revalidateFailed, startJob, validateJob } from "@/server/importer";
import { AppError } from "@/server/errors";
import type { FieldKey, ImportOptions } from "@/lib/import-fields";

type Ctx = { params: Promise<{ id: string }> };

/** Job status, counts and (optionally) a page of rows. Polled by the progress screen. */
export const GET = api(async (req: Request, ctx: Ctx) => {
  const actor = await requireActor(["owner"]);
  const { id } = await ctx.params;
  const u = new URL(req.url);
  const status = u.searchParams.get("rows");
  const job = await getJob(actor, id);
  const rows = status ? await listRows(actor, id, { status: status === "all" ? undefined : status, limit: Number(u.searchParams.get("limit") ?? 200), offset: Number(u.searchParams.get("offset") ?? 0) }) : undefined;
  return { job, rows };
});

/** Actions: validate (map + preview), start (confirm), retry (re-check failed rows), cancel. */
export const POST = api(async (req: Request, ctx: Ctx) => {
  const actor = await requireActor(["owner"]);
  const { id } = await ctx.params;
  const body = (await readJson(req)) as { action?: string; mapping?: Partial<Record<FieldKey, string>>; options?: Partial<ImportOptions> };
  switch (body.action) {
    case "validate": return validateJob(actor, id, { mapping: body.mapping ?? {}, options: body.options ?? {} });
    case "start": return startJob(actor, id);
    case "retry": return revalidateFailed(actor, id);
    case "cancel": return cancelJob(actor, id);
    default: throw new AppError("VALIDATION", "Unknown action");
  }
});
