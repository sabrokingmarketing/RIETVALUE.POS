/**
 * Runs once when the server starts. Resumes interrupted imports and schedules
 * housekeeping (resume stalled imports, remove abandoned uploads) every 30 seconds.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startScheduler } = await import("./server/scheduler");
  startScheduler();
}
