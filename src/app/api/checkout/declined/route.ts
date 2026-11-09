import { api, readJson } from "@/server/http";
import { requireActor } from "@/server/session";
import { recordDeclinedCard } from "@/server/checkout";

export const POST = api(async (req) => {
  const actor = await requireActor(["owner", "cashier"]);
  await recordDeclinedCard(actor, (await readJson(req)) as { checkoutRef: string; amountCents: number; note?: string });
  return { ok: true };
});
