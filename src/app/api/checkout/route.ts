import { api, readJson } from "@/server/http";
import { requireActor } from "@/server/session";
import { commitSale, type CheckoutInput } from "@/server/checkout";

/** Complete a sale. Safe to retry with the same idempotencyKey: returns the original sale. */
export const POST = api(async (req) => {
  const actor = await requireActor(["owner", "cashier"]);
  return commitSale(actor, (await readJson(req)) as CheckoutInput);
});
