import { pageActor } from "@/server/session";
import { getSettings } from "@/server/settings";
import { currentTill } from "@/server/till";
import { StaffBar } from "@/components/staff/staff-bar";

export const dynamic = "force-dynamic";

export default async function TillLayout({ children }: { children: React.ReactNode }) {
  const actor = await pageActor(["owner", "cashier"], "/till");
  const [settings, till] = await Promise.all([getSettings(), currentTill()]);
  return (
    <div className="flex min-h-dvh flex-col">
      <StaffBar actor={actor} businessName={settings.business_name} tillOpen={!!till} />
      <main className="flex min-h-0 flex-1 flex-col">{children}</main>
    </div>
  );
}
