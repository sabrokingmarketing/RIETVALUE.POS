import { api } from "@/server/http";
import { requireActor } from "@/server/session";
import { searchVariants } from "@/server/catalog";
import { toTillItem } from "@/server/till-api";

/** POS product grid and search: optional term and category; active items only. */
export const GET = api(async (req) => {
  await requireActor(["owner", "cashier"]);
  const u = new URL(req.url).searchParams;
  const term = (u.get("q") ?? "").slice(0, 60);
  const rows = await searchVariants(term, { limit: Math.min(Number(u.get("limit") ?? 60) || 60, 100), category: u.get("category") ?? undefined });
  return { items: rows.map(toTillItem) };
});
