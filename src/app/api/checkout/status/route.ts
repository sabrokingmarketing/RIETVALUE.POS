import { api } from "@/server/http";
import { requireActor } from "@/server/session";
import { findSaleByKey } from "@/server/checkout";
import { AppError } from "@/server/errors";

/** Recovery: did a sale with this checkout reference commit? */
export const GET = api(async (req) => {
  await requireActor(["owner", "cashier"]);
  const key = new URL(req.url).searchParams.get("key") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(key)) throw new AppError("VALIDATION", "Invalid checkout reference");
  return { sale: await findSaleByKey(key) };
});
