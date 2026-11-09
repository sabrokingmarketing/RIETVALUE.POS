import type { Metadata } from "next";
import { pageActor } from "@/server/session";
import { listPresets, MIN_MODULE_MM } from "@/server/labels";
import { Card, PageHeader } from "@/components/ui";
import { PresetForm } from "./preset-form";
import { SectionTabs } from "@/components/section-tabs";

export const metadata: Metadata = { title: "Label sizes" };

export default async function PresetsPage() {
  await pageActor(["owner"], "/admin/labels/presets");
  const presets = await listPresets();
  return (
    <div className="mx-auto max-w-4xl">
      <SectionTabs set="settings" active="/admin/labels/presets" />
      <PageHeader title="Label sizes and sheet layout" description={`Measure your label stock with a ruler. Layouts that are too small for a scannable barcode are rejected (narrowest bar ${MIN_MODULE_MM} mm, quiet zone 10 bars each side).`} />
      <div className="flex flex-col gap-6">
        {presets.map((p) => <Card key={p.id} className="p-5"><PresetForm preset={p} /></Card>)}
        <Card className="p-5"><h2 className="mb-3 font-semibold">Add a label size</h2><PresetForm /></Card>
      </div>
    </div>
  );
}
