import { api } from "@/server/http";
import { requireActor } from "@/server/session";
import { exportProducts } from "@/server/exporter";
import { fileResponse } from "@/server/file-response";

/** Owners export every column; cashiers a price list. Filters: q, category, status, low. */
export const GET = api(async (req: Request) => {
  const actor = await requireActor(["owner", "cashier"]);
  const u = new URL(req.url).searchParams;
  const status = u.get("status");
  const f = await exportProducts(actor, u.get("format") === "csv" ? "csv" : "xlsx", {
    term: (u.get("q") ?? "").slice(0, 60), category: /^[a-z0-9-]{1,60}$/.test(u.get("category") ?? "") ? u.get("category")! : undefined,
    status: status === "archived" || status === "all" ? status : "active", lowOnly: u.get("low") === "1",
  });
  return fileResponse(f);
});
