import type { Metadata } from "next";
import { pageActor } from "@/server/session";
import { recentJobs } from "@/server/importer";
import { listCategories } from "@/server/catalog";
import { PageHeader } from "@/components/ui";
import { ImportWizard } from "@/components/data/import-wizard";
import { ExportPanel } from "@/components/data/export-panel";

export const metadata: Metadata = { title: "Import/Export" };

export default async function ImportExportPage({ searchParams }: { searchParams: Promise<{ job?: string }> }) {
  const actor = await pageActor(["owner"], "/admin/import-export");
  const [recent, categories] = await Promise.all([recentJobs(actor, 10), listCategories()]);
  const job = (await searchParams).job;
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Import/Export" description="Add or update many plants at once from a spreadsheet, or export your products to edit them in Excel." />
      <section aria-labelledby="import-h" className="flex flex-col gap-4">
        <h2 id="import-h" className="text-xl font-semibold">Import products</h2>
        <ImportWizard recent={recent} initialJobId={job && /^[0-9a-f-]{36}$/i.test(job) ? job : undefined} />
      </section>
      <ExportPanel categories={categories} isOwner />
    </div>
  );
}
