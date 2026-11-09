import { api } from "@/server/http";
import { requireActor } from "@/server/session";
import { createImportJob, recentJobs } from "@/server/importer";
import { MAX_FILE_BYTES } from "@/server/spreadsheet";
import { AppError } from "@/server/errors";

/** Step 1: upload a CSV/XLSX. Returns the job with detected headers and a suggested mapping. */
export const POST = api(async (req: Request) => {
  const actor = await requireActor(["owner"]);
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_FILE_BYTES + 64_000) throw new AppError("VALIDATION", "The file is larger than 10 MB.");
  const form = await req.formData().catch(() => { throw new AppError("VALIDATION", "Upload a file."); });
  const file = form.get("file");
  if (!(file instanceof File)) throw new AppError("VALIDATION", "Choose a CSV or XLSX file to upload.");
  return createImportJob(actor, file.name, Buffer.from(await file.arrayBuffer()));
});

export const GET = api(async () => {
  const actor = await requireActor(["owner"]);
  return { jobs: await recentJobs(actor, 15) };
});
