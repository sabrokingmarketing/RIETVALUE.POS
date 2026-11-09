import type { Metadata } from "next";
import { pageActor } from "@/server/session";
import { currentTill } from "@/server/till";
import { posCategories } from "@/server/catalog";
import { getSettings } from "@/server/settings";
import { TillScreen } from "@/components/till/till-screen";

export const metadata: Metadata = { title: "POS" };

export default async function TillPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const actor = await pageActor(["owner", "cashier"], "/till");
  const [till, categories, settings] = await Promise.all([currentTill(), posCategories(), getSettings()]);
  const q = ((await searchParams).q ?? "").slice(0, 60);
  return <TillScreen tillOpen={!!till} staffName={actor.name} categories={categories} vatRateBp={settings.vat_registered ? settings.vat_rate_bp : 0} initialQuery={q} />;
}
