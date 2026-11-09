import type { Metadata } from "next";
import Link from "next/link";
import { PackagePlus, Tags, Sprout, ShoppingBasket } from "lucide-react";
import { pageActor } from "@/server/session";
import { dayReport } from "@/server/reports";
import { relabelQueue } from "@/server/catalog";
import { getSettings } from "@/server/settings";
import { ledgerMismatches } from "@/server/stock";
import { q } from "@/server/db";
import { todayBusinessDate, formatBusinessDate } from "@/lib/dates";
import { formatRand } from "@/lib/money";
import { Alert, Badge, Card, PageHeader, buttonClass } from "@/components/ui";

export const metadata: Metadata = { title: "Owner workspace" };

export default async function AdminHome() {
  const actor = await pageActor(["owner"], "/admin");
  const today = todayBusinessDate();
  const [report, relabel, settings, mismatches, demo] = await Promise.all([dayReport(actor, today), relabelQueue(), getSettings(), ledgerMismatches(),
    q<{ email: string }>(`SELECT email FROM "user" WHERE email LIKE '%@demo.test' AND active`)]);
  const actions = [
    { href: "/admin/receive", label: "Receive stock", icon: PackagePlus, text: "Count in a delivery and print its labels." },
    { href: "/admin/labels", label: "Print labels", icon: Tags, text: "Batches, reprints and replacement shelf labels." },
    { href: "/admin/products/new", label: "Add a plant", icon: Sprout, text: "New plant, pot or supply with its first size." },
    { href: "/till", label: "Open the till", icon: ShoppingBasket, text: "Scan and sell." },
  ];
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Today" description={formatBusinessDate(today)} />
      {settings.is_fixture && (
        <Alert tone="warn" title="Before launch: replace the placeholder business details" className="mb-4">
          The name, address, contact numbers and VAT settings are development fixtures. <Link className="font-semibold underline" href="/admin/settings">Open Settings</Link>
        </Alert>
      )}
      {demo.length > 0 && (
        <Alert tone="error" title="Demo accounts are active" className="mb-4">
          {demo.map((d) => d.email).join(", ")} must not exist on the live system. Deactivate them under <Link className="font-semibold underline" href="/admin/staff">Staff</Link>.
        </Alert>
      )}
      {mismatches.length > 0 && <Alert tone="error" className="mb-4">Stock ledger check found {mismatches.length} item(s) whose count does not match their movement history. Contact support.</Alert>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[["Net sales", formatRand(report.netCents)], ["Sales", String(report.salesCount)], ["Cash (net)", formatRand(report.netCashCents)], ["Card (net)", formatRand(report.netCardCents)]].map(([k, v]) => (
          <Card key={k} className="p-4"><p className="text-sm text-muted">{k}</p><p className="tabular mt-1 text-2xl font-semibold">{v}</p></Card>
        ))}
      </div>
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {actions.map((a) => (
          <Link key={a.href} href={a.href} className="group flex min-h-24 flex-col gap-1 rounded-xl border border-line bg-surface p-4 hover:border-forest hover:bg-leaf">
            <span className="flex items-center gap-2 font-semibold text-forest"><a.icon className="size-5" aria-hidden />{a.label}</span>
            <span className="text-sm text-muted">{a.text}</span>
          </Link>
        ))}
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card className="p-4">
          <div className="flex items-center justify-between"><h2 className="font-semibold">Low stock</h2><Link className="text-sm text-forest underline" href="/admin/stock?filter=low">See all</Link></div>
          {report.lowStock.length === 0 ? <p className="mt-2 text-sm text-muted">Nothing is low.</p> : (
            <ul className="mt-2 divide-y divide-line text-sm">
              {report.lowStock.slice(0, 8).map((v) => (
                <li key={v.id} className="flex justify-between gap-2 py-2"><span>{v.common_name} — {v.size_label}</span>
                  <Badge tone={v.on_hand === 0 ? "danger" : "warn"}>{v.on_hand === 0 ? "Sold out" : `${v.on_hand} left`}</Badge></li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between"><h2 className="font-semibold">Shelf labels to replace</h2><Link className="text-sm text-forest underline" href="/admin/labels#relabel">Print replacements</Link></div>
          {relabel.length === 0 ? <p className="mt-2 text-sm text-muted">All shelf labels show current prices.</p> : (
            <ul className="mt-2 divide-y divide-line text-sm">
              {relabel.slice(0, 8).map((v) => (
                <li key={v.id} className="flex justify-between gap-2 py-2"><span>{v.common_name} — {v.size_label}</span>
                  <span className="tabular">{v.old_cents ? <><s className="text-muted">{formatRand(v.old_cents)}</s> → </> : null}<strong>{formatRand(v.price_cents)}</strong></span></li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <p className="mt-6 text-sm"><Link className={buttonClass("secondary")} href={`/admin/reports?date=${today}`}>Full day report and till reconciliation</Link></p>
    </div>
  );
}
