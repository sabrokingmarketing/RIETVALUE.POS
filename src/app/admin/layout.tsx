import { pageActor } from "@/server/session";
import { getSettings } from "@/server/settings";
import { currentTill } from "@/server/till";
import { AppShell } from "@/components/shell/app-shell";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const actor = await pageActor(["owner"], "/admin");
  const [settings, till] = await Promise.all([getSettings(), currentTill()]);
  return <AppShell actor={actor} businessName={settings.business_name} tillOpen={!!till}><div className="mx-auto w-full max-w-7xl">{children}</div></AppShell>;
}
