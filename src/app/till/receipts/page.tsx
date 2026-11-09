import type { Metadata } from "next";
import Link from "next/link";
import { pageActor } from "@/server/session";
import { findReceipts } from "@/server/receipts";
import { formatDateTime, isYmd, todayBusinessDate } from "@/lib/dates";
import { formatRand } from "@/lib/money";
import { Badge, Button, EmptyState, PageHeader, Table, inputClass, td, th } from "@/components/ui";

export const metadata: Metadata = { title: "Receipts" };

export default async function ReceiptsPage({ searchParams }: { searchParams: Promise<{ q?: string; date?: string }> }) {
  const sp = await searchParams;
  const actor = await pageActor(["owner", "cashier"], "/till/receipts");
  const term = (sp.q ?? "").slice(0, 60);
  const date = sp.date === "all" ? "" : sp.date && isYmd(sp.date) ? sp.date : term ? "" : todayBusinessDate();
  const rows = await findReceipts(actor, { term, date });
  return (
    <div className="mx-auto w-full max-w-5xl p-4">
      <PageHeader title="Receipts" description="Find a sale to reprint its receipt or process a return." />
      <form className="mb-4 grid gap-2 rounded-xl border border-line bg-surface p-3 sm:grid-cols-[1fr_auto_auto]" role="search">
        <label className="sr-only" htmlFor="q">Receipt number, card reference, checkout reference or amount</label>
        <input id="q" name="q" defaultValue={term} className={inputClass} placeholder="Receipt no. (S000123 or 123), card ref, checkout ref or amount" />
        <label className="sr-only" htmlFor="date">Business date</label>
        <input id="date" name="date" type="date" defaultValue={date} className={inputClass} />
        <Button type="submit">Search</Button>
      </form>
      {rows.length === 0 ? (
        <EmptyState title="No receipts found">{date ? `No sales on ${date} match.` : "Try the receipt number printed at the top of the slip."}</EmptyState>
      ) : (
        <Table>
          <thead><tr><th className={th}>Receipt</th><th className={th}>Time</th><th className={th}>Items</th><th className={th}>Payment</th><th className={`${th} text-right`}>Total</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-leaf">
                <td className={td}><Link href={`/till/receipts/${r.id}`} className="inline-flex min-h-11 items-center font-mono font-semibold text-forest underline">{r.receipt_no}</Link>{r.has_returns && <> <Badge tone="warn">Returns</Badge></>}</td>
                <td className={td}>{formatDateTime(r.created_at)}<span className="block text-xs text-muted">{r.cashier_name}</span></td>
                <td className={td}>{r.items}</td>
                <td className={td}>{r.method === "cash" ? "Cash" : "Card"}</td>
                <td className={`${td} tabular text-right font-semibold`}>{formatRand(r.total_cents)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
