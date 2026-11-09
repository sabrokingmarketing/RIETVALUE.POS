import { api } from "@/server/http";
import { requireActor } from "@/server/session";
import { searchVariants } from "@/server/catalog";
import { toTillItem } from "@/server/till-api";

export const GET = api(async (req) => {
  await requireActor(["owner", "cashier"]);
  const term = (new URL(req.url).searchParams.get("q") ?? "").slice(0, 60);
  const rows = await searchVariants(term, { limit: 24 });
  return { items: rows.map(toTillItem) };
});
