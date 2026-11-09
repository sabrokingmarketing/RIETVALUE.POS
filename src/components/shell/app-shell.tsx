import Link from "next/link";
import { Search, Sprout } from "lucide-react";
import type { Actor } from "@/server/session-types";
import { SideNav, MobileNav } from "./side-nav";
import { SignOutButton } from "@/components/staff/sign-out";

export type NavKey = "dashboard" | "pos" | "products" | "inventory" | "labels" | "sales" | "reports" | "data" | "settings";
export type NavItem = { key: NavKey; href: string; label: string; match: string[] };

export function navFor(role: Actor["role"]): NavItem[] {
  if (role === "owner") {
    return [
      { key: "dashboard", href: "/admin", label: "Dashboard", match: ["/admin$"] },
      { key: "pos", href: "/till", label: "POS", match: ["/till$"] },
      { key: "products", href: "/admin/products", label: "Products", match: ["/admin/products"] },
      { key: "inventory", href: "/admin/stock", label: "Inventory", match: ["/admin/stock", "/admin/receive"] },
      { key: "labels", href: "/admin/labels", label: "Barcode Labels", match: ["/admin/labels", "/till/labels"] },
      { key: "sales", href: "/till/receipts", label: "Sales", match: ["/till/receipts", "/till/cash"] },
      { key: "reports", href: "/admin/reports", label: "Reports", match: ["/admin/reports"] },
      { key: "data", href: "/admin/import-export", label: "Import/Export", match: ["/admin/import-export"] },
      { key: "settings", href: "/admin/settings", label: "Settings", match: ["/admin/settings", "/admin/staff"] },
    ];
  }
  return [
    { key: "pos", href: "/till", label: "POS", match: ["/till$"] },
    { key: "labels", href: "/till/labels", label: "Barcode Labels", match: ["/till/labels"] },
    { key: "sales", href: "/till/receipts", label: "Sales", match: ["/till/receipts", "/till/cash"] },
    { key: "data", href: "/till/export", label: "Export", match: ["/till/export"] },
  ];
}

const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";

/** Shared frame for every staff screen: sidebar, top bar with search, till status and user. */
export function AppShell({ actor, businessName, tillOpen, children, fullBleed }: {
  actor: Actor; businessName: string; tillOpen: boolean; children: React.ReactNode; fullBleed?: boolean;
}) {
  const items = navFor(actor.role);
  const brand = (
    <Link href={actor.role === "owner" ? "/admin" : "/till"} className="flex min-h-11 min-w-0 items-center gap-3 rounded-xl px-2">
      <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-ink" aria-hidden><Sprout className="size-5" /></span>
      <span className="truncate font-semibold">{businessName}</span>
    </Link>
  );
  const userCard = (
    <div className="flex items-center gap-3 rounded-2xl bg-white/10 p-2">
      <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-soft text-sm font-semibold text-deep" aria-hidden>{initials(actor.name)}</span>
      <span className="min-w-0 text-sm"><span className="block truncate font-medium">{actor.name}</span><span className="block text-xs opacity-80">{actor.role === "owner" ? "Owner" : "Cashier"}</span></span>
    </div>
  );
  return (
    <div className="min-h-dvh md:flex">
      {/* Tablet rail + desktop sidebar */}
      <aside className="on-dark no-print sticky top-0 hidden h-dvh shrink-0 flex-col gap-4 bg-deep p-3 text-white md:flex md:w-[92px] lg:w-64 lg:p-4" aria-label="Main navigation">
        <div className="hidden lg:block">{brand}</div>
        <Link href={actor.role === "owner" ? "/admin" : "/till"} className="mx-auto inline-flex size-11 items-center justify-center rounded-xl bg-primary text-ink lg:hidden" aria-label={`${businessName} home`}><Sprout className="size-5" aria-hidden /></Link>
        <SideNav items={items} />
        <div className="mt-auto hidden flex-col gap-2 lg:flex">{userCard}<SignOutButton className="justify-center bg-white text-deep hover:bg-soft" /></div>
        <div className="mt-auto lg:hidden"><SignOutButton className="w-full flex-col justify-center gap-0.5 px-1 text-[11px]" compact /></div>
      </aside>

      <div className="flex min-h-dvh min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
          <div className="flex items-center gap-2 px-3 py-2 sm:gap-3 sm:px-5">
            <MobileNav items={items} brand={businessName} userName={actor.name} role={actor.role} />
            <form action={actor.role === "owner" ? "/admin/products" : "/till"} role="search" className="relative min-w-0 flex-1 md:max-w-md">
              <label htmlFor="global-search" className="sr-only">Search products</label>
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
              <input id="global-search" name="q" type="search" placeholder="Search products, SKU or barcode"
                className="min-h-11 w-full rounded-full border border-field/70 bg-mist pl-9 pr-4 text-sm placeholder:text-muted focus-visible:bg-surface" />
            </form>
            <span className={`ml-auto hidden whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold sm:inline-flex ${tillOpen ? "bg-soft text-deep" : "bg-warn-bg text-warn"}`}>
              {tillOpen ? "Till open" : "Till closed"}
            </span>
            <span className="hidden items-center gap-2 rounded-full bg-mist py-1 pl-1 pr-3 ring-1 ring-line md:inline-flex">
              <span className="inline-flex size-8 items-center justify-center rounded-full bg-deep text-xs font-semibold text-white" aria-hidden>{initials(actor.name)}</span>
              <span className="text-sm"><span className="font-medium">{actor.name}</span> <span className="text-muted">· {actor.role === "owner" ? "Owner" : "Cashier"}</span></span>
            </span>
          </div>
        </header>
        <main className={fullBleed ? "flex min-h-0 flex-1 flex-col" : "min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8"}>{children}</main>
      </div>
    </div>
  );
}
