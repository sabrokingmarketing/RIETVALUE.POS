import { api } from "@/server/http";
import { requireActor } from "@/server/session";
import { renderJob } from "@/server/labels";
import { AppError } from "@/server/errors";

/** The label PDF for a print job. Prices and names are resolved from the database at render time. */
export const GET = api(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const actor = await requireActor(["owner", "cashier"]);
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) throw new AppError("NOT_FOUND", "Label job not found");
  const url = new URL(req.url);
  const { pdf } = await renderJob(actor, id, { outlines: url.searchParams.get("outlines") === "1" });
  return new Response(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${url.searchParams.get("download") === "1" ? "attachment" : "inline"}; filename="labels-${id}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
});
