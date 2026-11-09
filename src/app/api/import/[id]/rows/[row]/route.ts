import { api, readJson } from "@/server/http";
import { requireActor } from "@/server/session";
import { editRow } from "@/server/importer";
import { AppError } from "@/server/errors";

/** Correct a failed row's cells; it is re-checked immediately. */
export const PATCH = api(async (req: Request, ctx: { params: Promise<{ id: string; row: string }> }) => {
  const actor = await requireActor(["owner"]);
  const { id, row } = await ctx.params;
  const n = Number(row);
  if (!Number.isInteger(n) || n < 1) throw new AppError("NOT_FOUND", "Row not found");
  const body = (await readJson(req)) as { cells?: Record<string, string> };
  if (!body.cells || typeof body.cells !== "object") throw new AppError("VALIDATION", "Nothing to change");
  return editRow(actor, id, n, body.cells);
});
