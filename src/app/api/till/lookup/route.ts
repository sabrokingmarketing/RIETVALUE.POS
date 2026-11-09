import { api } from "@/server/http";
import { requireActor } from "@/server/session";
import { lookupCode } from "@/server/catalog";
import { toTillItem } from "@/server/till-api";
import { AppError } from "@/server/errors";

export const GET = api(async (req) => {
  await requireActor(["owner", "cashier"]);
  const code = new URL(req.url).searchParams.get("code") ?? "";
  const v = await lookupCode(code);
  if (!v) throw new AppError("NOT_FOUND", `No item has the code ${code.trim().slice(0, 48) || "(empty)"}.`);
  if (v.archived || v.product_archived) throw new AppError("INACTIVE_PRODUCT", `${v.common_name} — ${v.size_label} is archived and cannot be sold.`);
  return { item: toTillItem(v) };
});
