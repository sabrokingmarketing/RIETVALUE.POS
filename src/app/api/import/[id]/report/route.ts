import { api } from "@/server/http";
import { requireActor } from "@/server/session";
import { jobReport } from "@/server/importer";
import { fileResponse } from "@/server/file-response";

export const GET = api(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const actor = await requireActor(["owner"]);
  const { id } = await ctx.params;
  const format = new URL(req.url).searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  return fileResponse(await jobReport(actor, id, format));
});
