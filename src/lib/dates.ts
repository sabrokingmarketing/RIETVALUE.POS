export const TZ = "Africa/Johannesburg";

/** Today's business date (YYYY-MM-DD) in South Africa. */
export function todayBusinessDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function formatDateTime(d: Date | string): string {
  return new Intl.DateTimeFormat("en-ZA", {
    timeZone: TZ, year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(new Date(d));
}

export function formatTime(d: Date | string): string {
  return new Intl.DateTimeFormat("en-ZA", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(d));
}

/** "2026-11-09" -> "Monday 9 November 2026" */
export function formatBusinessDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Intl.DateTimeFormat("en-ZA", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" })
    .format(new Date(Date.UTC(y, m - 1, d)));
}

export function isYmd(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z"));
}

/** pg returns DATE as a JS Date at local midnight unless parsed; we keep DATE as text (see db types). */
