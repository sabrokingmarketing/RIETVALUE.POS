import type { Metadata } from "next";
import { pageActor } from "@/server/session";
import { dayReport } from "@/server/reports";
import { formatBusinessDate, formatDateTime, isYmd, todayBusinessDate } from "@/lib/dates";
import { formatRand } from "@/lib/money";
import { Badge, Button, Card, EmptyState, PageHeader, Table, buttonClass, inputClass, td, th } from "@/components/ui";

export const metadata: Metadata = { title: "Day report" };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const actor = await pageActor(["owner"], "/admin/reports");
  const sp = await searchParams;
  const date = sp.date && isYmd(sp.date) ? sp.date : todayBusinessDate();
  const r = await dayReport(actor, date);
  const tiles: [string, string, string?][] = [
    ["Gross sales", formatRand(r.grossCents), `${r.salesCount} sale${r.salesCount === 1 ? "" : "s"}`],
    ["Returns", formatRand(r.returnsCents), `${r.returnsCount} return${r.returnsCount === 1 ? "" : "s"}`],
    ["Net sales", formatRand(r.netCents), `VAT included ${formatRand(r.vatCents)}`],
    ["Cash (net)", formatRand(r.netCashCents), `${formatRand(r.cashInCents)} in · ${formatRand(r.cashRefundCents)} refunded`],
    ["Card (net)", formatRand(r.netCardCents), `${formatRand(r.cardInCents)} in · ${formatRand(r.cardRefundCents)} refunded`],
  ];
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Day report" description={formatBusinessDate(date) + " (South African business day)"}
        actions={<a className={buttonClass("secondary")} href={`/api/reports/day?date=${date}`} download>Download CSV</a>} />
      <form className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex flex-col gap-1"><label htmlFor="date" className="text-sm font-medium">Business date</label>
          <input id="date" name="date" type="date" defaultValue={date} max={todayBusinessDate()} className={inputClass} /></div>
        <Button type="submit" variant="secondary">Show</Button>
      </form>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" data-testid="report-tiles">
        {tiles.map(([k, v, s]) => (
          <Card key={k} className="p-4"><p className="text-sm text-muted">{k}</p><p className="tabular mt-1 text-2xl font-semibold" data-testid={`tile-${k.toLowerCase().replace(/[^a-z]+/g, "-")}`}>{v}</p>{s && <p className="mt-1 text-xs text-muted">{s}</p>}</Card>
        ))}
      </div>
      <h2 className="mt-8 mb-2 text-lg font-semibold">Till reconciliation</h2>
      {r.tills.length === 0 ? <EmptyState title="The till was not opened on this day" /> : (
        <Table>
          <thead><tr><th className={th}>Opened</th><th className={th}>Closed</th><th className={`${th} text-right`}>Float</th><th className={`${th} text-right`}>Cash in</th><th className={`${th} text-right`}>Cash refunds</th><th className={`${th} text-right`}>Expected</th><th className={`${th} text-right`}>Counted</th><th className={`${th} text-right`}>Variance</th></tr></thead>
          <tbody>
            {r.tills.map((t) => (
              <tr key={t.id}>
                <td className={td}>{formatDateTime(t.opened_at)}<span className="block text-xs text-muted">{t.opened_by_name}</span></td>
                <td className={td}>{t.closed_at ? <>{formatDateTime(t.closed_at)}<span className="block text-xs text-muted">{t.closed_by_name}</span></> : <Badge tone="green">Still open</Badge>}</td>
                <td className={`${td} tabular text-right`}>{formatRand(t.opening_float_cents)}</td>
                <td className={`${td} tabular text-right`}>{formatRand(t.summary.cash_in)}</td>
                <td className={`${td} tabular text-right`}>{formatRand(t.summary.cash_out)}</td>
                <td className={`${td} tabular text-right font-semibold`}>{formatRand(t.expected_cash_cents ?? t.summary.expected)}</td>
                <td className={`${td} tabular text-right`}>{t.counted_cash_cents === null ? "—" : formatRand(t.counted_cash_cents)}</td>
                <td className={`${td} tabular text-right font-semibold`}>{t.variance_cents === null ? "—" : <span className={t.variance_cents === 0 ? "text-forest" : "text-danger"}>{t.variance_cents > 0 ? "+" : ""}{formatRand(t.variance_cents)}</span>}
                  {t.close_note && <span className="block text-xs font-normal text-muted">{t.close_note}</span>}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <section>
          <h2 className="mb-2 text-lg font-semibold">Top plants</h2>
          {r.topPlants.length === 0 ? <EmptyState title="No plants sold on this day" /> : (
            <Table>
              <thead><tr><th className={th}>Plant</th><th className={`${th} text-right`}>Sold</th><th className={`${th} text-right`}>Returned</th><th className={`${th} text-right`}>Net</th></tr></thead>
              <tbody>{r.topPlants.map((p) => (
                <tr key={p.variant_id}><td className={td}>{p.description}</td><td className={`${td} tabular text-right`}>{p.sold}</td><td className={`${td} tabular text-right`}>{p.returned}</td><td className={`${td} tabular text-right font-semibold`}>{formatRand(p.net_cents)}</td></tr>
              ))}</tbody>
            </Table>
          )}
        </section>
        <section>
          <h2 className="mb-2 text-lg font-semibold">Low stock now</h2>
          {r.lowStock.length === 0 ? <EmptyState title="Nothing is low" /> : (
            <Table>
              <thead><tr><th className={th}>Item</th><th className={`${th} text-right`}>On hand</th><th className={`${th} text-right`}>Warn at</th></tr></thead>
              <tbody>{r.lowStock.map((v) => (
                <tr key={v.id}><td className={td}>{v.common_name} — {v.size_label}</td><td className={`${td} tabular text-right font-semibold`}>{v.on_hand}</td><td className={`${td} tabular text-right`}>{v.low_stock_threshold}</td></tr>
              ))}</tbody>
            </Table>
          )}
        </section>
      </div>
    </div>
  );
}
