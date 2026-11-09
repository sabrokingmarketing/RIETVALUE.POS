import "server-only";

type Level = "info" | "warn" | "error";

/** One JSON line per event on stdout/stderr (collected by systemd-journald or Docker). No secrets or request bodies. */
export function log(level: Level, event: string, detail: Record<string, unknown> = {}, err?: unknown) {
  const e = err instanceof Error ? { error: err.message, stack: err.stack?.split("\n").slice(0, 6).join(" | ") } : err !== undefined ? { error: String(err) } : {};
  const line = JSON.stringify({ t: new Date().toISOString(), level, event, ...detail, ...e });
  (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(line);
}
