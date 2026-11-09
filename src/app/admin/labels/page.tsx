import type { Metadata } from "next";
import { pageActor } from "@/server/session";
import { LabelsPage } from "@/components/labels/labels-page";

export const metadata: Metadata = { title: "Print labels" };

export default async function AdminLabels({ searchParams }: { searchParams: Promise<{ variant?: string; delivery?: string; job?: string }> }) {
  await pageActor(["owner"], "/admin/labels");
  return <LabelsPage isOwner searchParams={await searchParams} />;
}
