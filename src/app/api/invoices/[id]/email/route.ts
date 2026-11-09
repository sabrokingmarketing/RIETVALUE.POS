import { api, readJson } from "@/server/http";
import { requireActor } from "@/server/session";
import { sendInvoiceEmail } from "@/server/invoice-mail";

/** E-mail (or re-send) an issued invoice. Body: { to, message? } */
export const POST = api(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const actor = await requireActor(["owner", "cashier"]);
  const body = (await readJson(req)) as { to?: string; message?: string };
  return sendInvoiceEmail(actor, (await ctx.params).id, { to: String(body?.to ?? ""), message: String(body?.message ?? "") });
});
