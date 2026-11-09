import { api } from "@/server/http";
import { requireActor } from "@/server/session";
import { importTemplate } from "@/server/exporter";
import { fileResponse } from "@/server/file-response";

export const GET = api(async (req: Request) => {
  await requireActor(["owner"]);
  return fileResponse(await importTemplate(new URL(req.url).searchParams.get("format") === "csv" ? "csv" : "xlsx"));
});
