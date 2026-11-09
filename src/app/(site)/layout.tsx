import Link from "next/link";
import { Menu, Sprout } from "lucide-react";
import { getPublicSettings } from "@/server/settings";
import { WhatsAppButton } from "@/components/site/whatsapp";

export const dynamic = "force-dynamic";

const NAV = [{ href: "/", label: "Home" }, { href: "/plants", label: "Plants" }, { href: "/about", label: "About" }, { href: "/visit", label: "Visit & contact" }];

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const s = await getPublicSettings();
  return (
    <div className="flex min-h-dvh flex-col bg-surface">
      {s.is_fixture && (
        <p className="bg-warn-bg px-4 py-2 text-center text-sm text-ink" role="note">
          <strong>Development preview.</strong> Business name, address and contact details are placeholders, and plant pictures are illustrations.
        </p>
      )}
      <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link href="/" className="flex min-h-11 items-center gap-2 text-lg font-semibold text-forest"><Sprout className="size-6" aria-hidden /> {s.business_name}</Link>
          <nav aria-label="Main" className="hidden gap-1 md:flex">
            {NAV.map((n) => <Link key={n.href} href={n.href} className="inline-flex min-h-11 items-center rounded-lg px-3 font-medium hover:bg-leaf">{n.label}</Link>)}
          </nav>
          <details className="relative md:hidden">
            <summary className="flex min-h-11 min-w-11 cursor-pointer list-none items-center justify-center rounded-lg border border-line" aria-label="Menu"><Menu className="size-5" aria-hidden /></summary>
            <nav aria-label="Main" className="absolute right-0 mt-2 flex w-56 flex-col rounded-xl border border-line bg-surface p-2 shadow-lg">
              {NAV.map((n) => <Link key={n.href} href={n.href} className="flex min-h-11 items-center rounded-lg px-3 font-medium hover:bg-leaf">{n.label}</Link>)}
            </nav>
          </details>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="mt-16 bg-ink text-white">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-3">
          <div>
            <p className="text-lg font-semibold">{s.business_name}</p>
            {s.address_lines && <p className="mt-2 whitespace-pre-line text-sm opacity-90">{s.address_lines}</p>}
          </div>
          <div>
            <p className="font-semibold">Opening hours</p>
            <p className="mt-2 whitespace-pre-line text-sm opacity-90">{s.opening_hours || "Ask us for our hours."}</p>
          </div>
          <div className="flex flex-col items-start gap-2 text-sm">
            <p className="font-semibold">Get in touch</p>
            {s.phone && <a className="underline" href={`tel:${s.phone.replace(/\s/g, "")}`}>{s.phone}</a>}
            {s.email && <a className="underline" href={`mailto:${s.email}`}>{s.email}</a>}
            <div className="on-dark mt-2"><WhatsAppButton number={s.whatsapp_number} text={`Hi ${s.business_name}, I have a question.`} label="WhatsApp us" fixture={s.is_fixture} /></div>
            <Link href="/login" className="mt-4 text-xs opacity-70 underline">Staff sign-in</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
