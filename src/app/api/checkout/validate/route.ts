import { api, readJson } from "@/server/http";
import { requireActor } from "@/server/session";
import { validateBasket, type BasketLine } from "@/server/checkout";

export const POST = api(async (req) => {
  const actor = await requireActor(["owner", "cashier"]);
  const body = (await readJson(req)) as { lines?: BasketLine[] };
  return validateBasket(actor, body.lines ?? []);
});
