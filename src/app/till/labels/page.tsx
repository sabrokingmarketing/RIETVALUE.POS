import type { Metadata } from "next";
import { pageActor } from "@/server/session";
import { LabelsPage } from "@/components/labels/labels-page";

export const metadata: Metadata = { title: "Print labels" };

export default async function TillLabels({ searchParams }: { searchParams: Promise<{ variant?: string; delivery?: string; job?: string }> }) {
  const actor = await pageActor(["owner", "cashier"], "/till/labels");
  return <div className="p-4"><LabelsPage isOwner={actor.role === "owner"} searchParams={await searchParams} /></div>;
}
