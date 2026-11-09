import { pageActor } from "@/server/session";
import { getSettings } from "@/server/settings";
import { currentTill } from "@/server/till";
import { StaffBar } from "@/components/staff/staff-bar";
import { NavLinks } from "@/components/staff/nav-links";

export const dynamic = "force-dynamic";

const LINKS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/receive", label: "Receive stock" },
  { href: "/admin/labels", label: "Print labels" },
  { href: "/admin/products", label: "Plants & products" },
  { href: "/admin/stock", label: "Stock" },
  { href: "/admin/reports", label: "Day report" },
  { href: "/admin/staff", label: "Staff" },
  { href: "/admin/settings", label: "Settings" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const actor = await pageActor(["owner"], "/admin");
  const [settings, till] = await Promise.all([getSettings(), currentTill()]);
  return (
    <div className="flex min-h-dvh flex-col">
      <StaffBar actor={actor} businessName={settings.business_name} tillOpen={!!till} />
      <div className="flex flex-1 flex-col lg:flex-row">
        <nav aria-label="Owner workspace" className="no-print flex gap-1 overflow-x-auto border-b border-line bg-surface px-2 py-1.5 lg:w-56 lg:flex-col lg:overflow-visible lg:border-r lg:border-b-0 lg:p-3">
          <NavLinks links={LINKS} variant="light" />
        </nav>
        <main className="min-w-0 flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
