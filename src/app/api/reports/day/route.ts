import { api } from "@/server/http";
import { requireActor } from "@/server/session";
import { dayCsv } from "@/server/reports";
import { isYmd } from "@/lib/dates";
import { AppError } from "@/server/errors";

export const GET = api(async (req: Request) => {
  const actor = await requireActor(["owner"]);
  const date = new URL(req.url).searchParams.get("date") ?? "";
  if (!isYmd(date)) throw new AppError("VALIDATION", "Choose a valid date");
  const csv = await dayCsv(actor, date);
  return new Response(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="sales-${date}.csv"`, "Cache-Control": "no-store" },
  });
});
