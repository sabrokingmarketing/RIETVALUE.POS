import type { Metadata } from "next";
import { pageActor } from "@/server/session";
import { listCategories } from "@/server/catalog";
import { PageHeader } from "@/components/ui";
import { ExportPanel } from "@/components/data/export-panel";

export const metadata: Metadata = { title: "Export" };

export default async function CashierExport() {
  const actor = await pageActor(["owner", "cashier"], "/till/export");
  const categories = await listCategories();
  return (
    <div className="mx-auto w-full max-w-5xl p-4 sm:p-6">
      <PageHeader title="Export" description="Download the price list. Importing products is done by the owner." />
      <ExportPanel categories={categories} isOwner={actor.role === "owner"} />
    </div>
  );
}
