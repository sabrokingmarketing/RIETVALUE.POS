import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Boxes, FileSpreadsheet, PackagePlus, Receipt, ShoppingCart, Sprout, Tags, TriangleAlert } from "lucide-react";
import { pageActor } from "@/server/session";
import { dashboardData } from "@/server/dashboard";
import { getSettings } from "@/server/settings";
import { ledgerMismatches } from "@/server/stock";
import { q } from "@/server/db";
import { formatBusinessDate, formatTime } from "@/lib/dates";
import { formatRand } from "@/lib/money";
import { Alert, Badge, Card, StatTile, buttonClass } from "@/components/ui";
import { SalesBars, SplitRing } from "@/components/charts";

export const metadata: Metadata = { title: "Dashboard" };

export default async function Dashboard() {
  const actor = await pageActor(["owner"], "/admin");
  const [d, settings, mismatches, demo] = await Promise.all([dashboardData(actor), getSettings(), ledgerMismatches(),
    q<{ email: string }>(`SELECT email FROM "user" WHERE email LIKE '%@demo.test' AND active`)]);
  const change = d.yesterdayNet ? Math.round(((d.todayNet - d.yesterdayNet) / Math.abs(d.yesterdayNet)) * 100) : null;
  const cash = d.split.find((s) => s.method === "cash")?.amount ?? 0, card = d.split.find((s) => s.method === "card")?.amount ?? 0;
  const actions = [
    { href: "/admin/products/new", label: "Add a plant", icon: Sprout },
    { href: "/admin/receive", label: "Receive stock", icon: PackagePlus },
    { href: "/admin/labels", label: "Print labels", icon: Tags },
    { href: "/admin/import-export", label: "Import products", icon: FileSpreadsheet },
  ];
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div><h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1><p className="text-sm text-muted">{formatBusinessDate(d.today)}</p></div>
        <Link href="/till" className={buttonClass("primary", "lg")}><ShoppingCart className="size-5" aria-hidden /> Open POS</Link>
      </div>

      {settings.is_fixture && <Alert tone="warn" title="Before launch: replace the placeholder business details">The name, address, phone and VAT settings are development fixtures. <Link className="font-semibold underline" href="/admin/settings">Open Settings</Link></Alert>}
      {demo.length > 0 && <Alert tone="error" title="Demo accounts are active">{demo.map((x) => x.email).join(", ")} must not exist on the live system. Deactivate them under <Link className="font-semibold underline" href="/admin/staff">Staff</Link>.</Alert>}
      {mismatches.length > 0 && <Alert tone="error">Stock check: {mismatches.length} item(s) don&apos;t match their movement history. Contact support.</Alert>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Net sales today" value={formatRand(d.todayNet)} testId="dash-net" icon={<Receipt className="size-5" />}
          sub={change === null ? "No sales yesterday to compare" : <span className="inline-flex items-center gap-1">{change >= 0 ? <ArrowUpRight className="size-3.5" aria-hidden /> : <ArrowDownRight className="size-3.5" aria-hidden />}{Math.abs(change)}% vs yesterday</span>} />
        <StatTile label="Sales today" value={d.todaySales} sub={`${d.todayItems} item${d.todayItems === 1 ? "" : "s"} sold`} icon={<ShoppingCart className="size-5" />} />
        <StatTile label="Stock on hand" value={d.counts.units.toLocaleString("en-ZA")} sub={`${d.counts.products} sizes for sale`} icon={<Boxes className="size-5" />} />
        <StatTile label="Low stock" value={d.counts.low} tone={d.counts.low ? "warn" : "neutral"} sub={d.counts.relabel ? `${d.counts.relabel} shelf label${d.counts.relabel === 1 ? "" : "s"} to replace` : "Shelf labels up to date"} icon={<TriangleAlert className="size-5" />} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card className="p-5">
          <div className="mb-2 flex items-center justify-between gap-2"><h2 className="font-semibold">Net sales</h2><span className="rounded-full bg-deep px-3 py-1 text-xs font-semibold text-white">Last 14 days</span></div>
          <SalesBars data={d.series} highlight={d.today} />
        </Card>
        <Card className="flex flex-col gap-4 p-5">
          <h2 className="font-semibold">Payments · last 7 days</h2>
          <SplitRing a={cash} b={card} aLabel="Cash" bLabel="Card" />
          <div className="grid grid-cols-2 gap-2">
            {actions.map((a) => (
              <Link key={a.href} href={a.href} className="flex min-h-14 items-center gap-2 rounded-xl border border-line p-3 text-sm font-semibold hover:border-deep/40 hover:bg-soft">
                <a.icon className="size-5 text-deep" aria-hidden />{a.label}
              </Link>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="p-5">
          <h2 className="mb-3 font-semibold">Top plants · 7 days</h2>
          {d.top.length === 0 ? <p className="text-sm text-muted">No sales yet this week.</p> : (
            <ol className="flex flex-col gap-2">
              {d.top.map((t, i) => (
                <li key={t.name} className="flex items-center gap-3">
                  <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-soft text-xs font-bold text-deep">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-sm">{t.name}</span>
                  <span className="tabular text-sm font-semibold">{t.qty}×</span>
                </li>
              ))}
            </ol>
          )}
        </Card>
        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">Low stock</h2><Link className="text-sm font-semibold text-deep underline" href="/admin/stock?filter=low">View all</Link></div>
          {d.low.length === 0 ? <p className="text-sm text-muted">Nothing is low.</p> : (
            <ul className="flex flex-col gap-2 text-sm">
              {d.low.map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-2"><span className="min-w-0 truncate">{v.name} — {v.size}</span>
                  <Badge tone={v.on_hand === 0 ? "danger" : "warn"}>{v.on_hand === 0 ? "Sold out" : `${v.on_hand} left`}</Badge></li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">Recent sales</h2><Link className="text-sm font-semibold text-deep underline" href="/till/receipts">All sales</Link></div>
          {d.recent.length === 0 ? <p className="text-sm text-muted">No sales yet.</p> : (
            <ul className="flex flex-col gap-2 text-sm">
              {d.recent.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2">
                  <Link href={`/till/receipts/${s.id}`} className="font-mono font-semibold text-deep underline">{s.receipt_no}</Link>
                  <span className="text-muted">{formatTime(s.created_at)} · {s.method}</span>
                  <span className="tabular font-semibold">{formatRand(s.total_cents)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
