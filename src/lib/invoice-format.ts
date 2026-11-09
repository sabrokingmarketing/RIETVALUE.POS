import { todayBusinessDate } from "./dates";

export type InvoiceStatusName = "draft" | "issued" | "paid" | "void";
export const PAID_METHODS = { cash: "Cash", card: "Card", eft: "EFT / bank transfer", other: "Other" } as const;
export type PaidMethod = keyof typeof PAID_METHODS;

/** Title that satisfies SARS wording when the business is VAT registered. */
export const invoiceTitle = (inv: { vat_registered: boolean }) => (inv.vat_registered ? "Tax invoice" : "Invoice");

/** "2026-11-09" -> "9 Nov 2026" */
export function shortDate(ymd: string | null | undefined): string {
  if (!ymd) return "—";
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
  return new Intl.DateTimeFormat("en-ZA", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(new Date(Date.UTC(y, m - 1, d)));
}
/** A timestamp's calendar date in South Africa (YYYY-MM-DD). */
export const saDate = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg" }).format(new Date(iso));

export function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export type InvoiceBadge = { label: string; tone: "green" | "warn" | "danger" | "neutral" };
export function invoiceBadge(inv: { status: InvoiceStatusName; due_date: string | null }, today = todayBusinessDate()): InvoiceBadge {
  if (inv.status === "paid") return { label: "Paid", tone: "green" };
  if (inv.status === "void") return { label: "Void", tone: "danger" };
  if (inv.status === "draft") return { label: "Draft", tone: "neutral" };
  if (inv.due_date && inv.due_date < today) return { label: "Overdue", tone: "danger" };
  return { label: "Awaiting payment", tone: "warn" };
}
