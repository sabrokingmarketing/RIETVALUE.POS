import type { Metadata } from "next";
import Link from "next/link";
import { pageActor } from "@/server/session";
import { listCategories } from "@/server/catalog";
import { listPresets } from "@/server/labels";
import { recentDeliveries } from "@/server/stock";
import { formatDateTime } from "@/lib/dates";
import { PageHeader } from "@/components/ui";
import { ReceiveScreen } from "./receive-screen";

export const metadata: Metadata = { title: "Receive stock" };

export default async function ReceivePage() {
  await pageActor(["owner"], "/admin/receive");
  const [categories, presets, recent] = await Promise.all([listCategories(), listPresets(), recentDeliveries(5)]);
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Receive stock" description="Add each plant in the delivery, count it, confirm the selling price, then save. Labels print after the stock is saved." />
      <ReceiveScreen categories={categories} defaultPresetId={presets.find((p) => p.is_default)?.id ?? presets[0]?.id} />
      {recent.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-2 font-semibold">Recent deliveries</h2>
          <ul className="divide-y divide-line rounded-xl border border-line bg-surface text-sm">
            {recent.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                <span><span className="font-mono font-semibold">{d.delivery_no}</span> · {formatDateTime(d.received_at)} · {d.units} units{d.supplier ? ` · ${d.supplier}` : ""}</span>
                <Link className="inline-flex min-h-11 items-center text-forest underline" href={`/admin/labels?delivery=${d.id}`}>Print labels again</Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
