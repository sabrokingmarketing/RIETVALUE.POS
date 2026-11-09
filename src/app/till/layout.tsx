import { pageActor } from "@/server/session";
import { getSettings } from "@/server/settings";
import { currentTill } from "@/server/till";
import { AppShell } from "@/components/shell/app-shell";

export const dynamic = "force-dynamic";

export default async function TillLayout({ children }: { children: React.ReactNode }) {
  const actor = await pageActor(["owner", "cashier"], "/till");
  const [settings, till] = await Promise.all([getSettings(), currentTill()]);
  // Full-height frame: the POS uses all of it; the other till pages add their own padding.
  return <AppShell actor={actor} businessName={settings.business_name} tillOpen={!!till} fullBleed>{children}</AppShell>;
}
