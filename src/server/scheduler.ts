import "server-only";
import { q } from "./db";
import { kickImportWorker } from "./importer";
import { log } from "./log";

declare global {
  // eslint-disable-next-line no-var
  var __nurseryScheduler: NodeJS.Timeout | undefined;
}

/** In-process scheduled jobs. Safe with several app processes: imports claim jobs with row locks. */
export function startScheduler() {
  if (globalThis.__nurseryScheduler || process.env.DISABLE_SCHEDULER === "1") return;
  const tick = async () => {
    try {
      await kickImportWorker();
      // Uploaded-but-never-started imports are removed after 7 days (rows cascade).
      await q(`DELETE FROM import_jobs WHERE status IN ('uploaded','validated') AND created_at < now() - interval '7 days'`);
    } catch (e) {
      log("error", "scheduler.tick", {}, e);
    }
  };
  setTimeout(tick, 2000);
  globalThis.__nurseryScheduler = setInterval(tick, 30_000);
  globalThis.__nurseryScheduler.unref?.();
}
