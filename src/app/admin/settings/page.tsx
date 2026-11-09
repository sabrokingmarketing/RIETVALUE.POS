import type { Metadata } from "next";
import Link from "next/link";
import { pageActor } from "@/server/session";
import { getSettings } from "@/server/settings";
import { Alert, PageHeader } from "@/components/ui";
import { SettingsForm } from "./form";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  await pageActor(["owner"], "/admin/settings");
  const s = await getSettings();
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Business settings" description={<>Shown on receipts and the website. Label sizes are under <Link className="underline" href="/admin/labels/presets">Print labels → label sizes</Link>.</>} />
      {s.is_fixture && <Alert tone="warn" className="mb-4" title="These are development placeholders">Replace every field with the nursery&apos;s real details before going live. Saving this form clears the placeholder flag.</Alert>}
      <SettingsForm s={s} />
    </div>
  );
}
