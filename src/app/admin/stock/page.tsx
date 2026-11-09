import type { Metadata } from "next";
import Link from "next/link";
import { pageActor } from "@/server/session";
import { stockList, movementHistory } from "@/server/stock";
import { MovementTable } from "./movement-table";
import { formatRand } from "@/lib/money";
import { Badge, Button, EmptyState, PageHeader, Table, inputClass, td, th } from "@/components/ui";
import { AdjustButton } from "./adjust";
import { SectionTabs } from "@/components/section-tabs";

export const metadata: Metadata = { title: "Stock" };

export default async function StockPage({ searchParams }: { searchParams: Promise<{ filter?: string; q?: string }> }) {
  await pageActor(["owner"], "/admin/stock");
  const sp = await searchParams;
  const filter = sp.filter === "low" ? "low" : "all";
  const [rows, recent] = await Promise.all([stockList({ filter, term: sp.q?.slice(0, 60) }), movementHistory({ limit: 15 })]);
  return (
    <div className="mx-auto max-w-6xl">
      <SectionTabs set="inventory" active="/admin/stock" />
      <PageHeader title="Stock" description="Current stock for every size. Adjust with a reason; every change is recorded." />
      <form className="mb-4 flex flex-col gap-2 sm:flex-row" role="search">
        <label htmlFor="q" className="sr-only">Search stock</label>
        <input id="q" name="q" defaultValue={sp.q} placeholder="Search by name or SKU" className={inputClass} />
        <input type="hidden" name="filter" value={filter} />
        <Button type="submit" variant="secondary">Search</Button>
        <div className="flex gap-1">
          <Link href="/admin/stock" aria-current={filter === "all" ? "page" : undefined} className={`inline-flex min-h-11 items-center rounded-lg px-3 text-sm ${filter === "all" ? "bg-leaf font-semibold text-forest" : "hover:bg-mist"}`}>All</Link>
          <Link href="/admin/stock?filter=low" aria-current={filter === "low" ? "page" : undefined} className={`inline-flex min-h-11 items-center rounded-lg px-3 text-sm whitespace-nowrap ${filter === "low" ? "bg-leaf font-semibold text-forest" : "hover:bg-mist"}`}>Low stock</Link>
        </div>
      </form>
      {rows.length === 0 ? <EmptyState title={filter === "low" ? "Nothing is low on stock" : "No items found"} /> : (
        <Table>
          <thead><tr><th className={th}>Item</th><th className={th}>SKU</th><th className={`${th} text-right`}>Price</th><th className={`${th} text-right`}>On hand</th><th className={th}>Status</th><th className={th}><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const low = r.on_hand <= r.low_stock_threshold;
              return (
                <tr key={r.id} className={low ? "bg-warn-bg/40" : ""}>
                  <td className={td}><Link href={`/admin/products/${r.product_id}`} className="font-medium text-forest underline">{r.common_name}</Link><span className="block text-xs text-muted">{r.size_label}</span></td>
                  <td className={`${td} font-mono text-xs`}>{r.sku}</td>
                  <td className={`${td} tabular text-right`}>{formatRand(r.price_cents)}</td>
                  <td className={`${td} tabular text-right text-lg font-semibold`}>{r.on_hand}</td>
                  <td className={td}>{r.on_hand === 0 ? <Badge tone="danger">Sold out</Badge> : low ? <Badge tone="warn">Low (≤ {r.low_stock_threshold})</Badge> : <Badge tone="green">OK</Badge>}</td>
                  <td className={td}><div className="flex justify-end gap-1"><Link className="inline-flex min-h-11 items-center rounded-lg px-2 text-sm text-forest hover:bg-leaf" href={`/admin/stock/${r.id}`}>History</Link><AdjustButton variantId={r.id} label={`${r.common_name} — ${r.size_label}`} onHand={r.on_hand} /></div></td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
      <h2 className="mt-8 mb-2 text-lg font-semibold">Latest stock movements</h2>
      <MovementTable rows={recent} />
    </div>
  );
}
