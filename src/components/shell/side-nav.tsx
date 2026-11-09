"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Barcode, Boxes, FileSpreadsheet, FileText, LayoutDashboard, Menu, Receipt, Settings, ShoppingCart, Sprout, X } from "lucide-react";
import type { NavItem, NavKey } from "./app-shell";
import { SignOutButton } from "@/components/staff/sign-out";

const ICON: Record<NavKey, typeof Menu> = {
  dashboard: LayoutDashboard, pos: ShoppingCart, products: Sprout, inventory: Boxes, labels: Barcode,
  sales: Receipt, invoices: FileText, reports: BarChart3, data: FileSpreadsheet, settings: Settings,
};

function isActive(path: string, item: NavItem) {
  return item.match.some((m) => (m.endsWith("$") ? path === m.slice(0, -1) : path === m || path.startsWith(m + "/")));
}

/** Pages where the sidebar shrinks to an icon rail to give the work area more room. */
const COMPACT = ["/till"];

/** Tablet/desktop sidebar. On the POS screen it collapses to icons only (labels show as tooltips). */
export function SideRail({ items, homeHref, brand, userCard }: { items: NavItem[]; homeHref: string; brand: React.ReactNode; userCard: React.ReactNode }) {
  const path = usePathname();
  const compact = COMPACT.includes(path);
  return (
    <aside data-compact={compact || undefined} aria-label="Main navigation"
      className={`on-dark no-print sticky top-0 hidden h-dvh shrink-0 flex-col gap-4 bg-deep p-3 text-white transition-[width] duration-200 md:flex ${compact ? "md:w-[76px]" : "md:w-[92px] lg:w-64 lg:p-4"}`}>
      {!compact && <div className="hidden lg:block">{brand}</div>}
      <Link href={homeHref} className={`mx-auto inline-flex size-11 items-center justify-center rounded-xl bg-primary text-ink ${compact ? "" : "lg:hidden"}`} aria-label="Rietvalei POS home" title="Rietvalei POS"><Sprout className="size-5" aria-hidden /></Link>
      <nav className="flex flex-col gap-1">
        {items.map((it) => {
          const Icon = ICON[it.key]; const active = isActive(path, it);
          return (
            <Link key={it.key} href={it.href} aria-current={active ? "page" : undefined} aria-label={compact ? it.label : undefined}
              className={`group flex min-h-12 items-center rounded-xl font-medium leading-tight ${compact
                ? "relative justify-center"
                : "flex-col justify-center gap-0.5 px-1 text-[11px] lg:flex-row lg:justify-start lg:gap-3 lg:px-3 lg:text-sm"} ${
                active ? "bg-primary text-ink" : "text-white/90 hover:bg-white/10 hover:text-white"}`}>
              <Icon className="size-5 shrink-0" aria-hidden />
              {compact
                ? <span aria-hidden className="pointer-events-none absolute left-full z-50 ml-3 whitespace-nowrap rounded-lg bg-ink px-2.5 py-1.5 text-xs font-semibold text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">{it.label}</span>
                : <span className="text-center lg:text-left">{it.label}</span>}
            </Link>
          );
        })}
      </nav>
      {!compact && <div className="mt-auto hidden flex-col gap-2 lg:flex">{userCard}<SignOutButton className="justify-center bg-white text-deep hover:bg-soft" /></div>}
      <div className={`mt-auto ${compact ? "" : "lg:hidden"}`}><SignOutButton className="w-full flex-col justify-center gap-0.5 px-1 text-[11px]" compact /></div>
    </aside>
  );
}

/** Phone navigation: a menu button that opens a drawer with the same items. */
export function MobileNav({ items, brand, userName, role }: { items: NavItem[]; brand: string; userName: string; role: string }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [open]);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label="Open menu" aria-expanded={open}
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl border border-line md:hidden"><Menu className="size-5" aria-hidden /></button>
      {open && (
        <div className="fixed inset-0 z-50 md:hidden" data-dialog-open>
          <button type="button" className="absolute inset-0 bg-ink/50" aria-label="Close menu" onClick={() => setOpen(false)} />
          <div role="dialog" aria-modal="true" aria-label="Main navigation" className="on-dark absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col gap-4 overflow-y-auto bg-deep p-4 text-white">
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2 font-semibold"><span className="inline-flex size-9 items-center justify-center rounded-xl bg-primary text-ink" aria-hidden><Sprout className="size-5" /></span><span className="truncate">{brand}</span></span>
              <button type="button" onClick={() => setOpen(false)} className="inline-flex size-11 items-center justify-center rounded-xl hover:bg-white/10" aria-label="Close menu"><X className="size-5" aria-hidden /></button>
            </div>
            <nav className="flex flex-col gap-1">
              {items.map((it) => {
                const Icon = ICON[it.key]; const active = isActive(path, it);
                return (
                  <Link key={it.key} href={it.href} aria-current={active ? "page" : undefined}
                    className={`flex min-h-12 items-center gap-3 rounded-xl px-3 font-medium ${active ? "bg-primary text-ink" : "hover:bg-white/10"}`}>
                    <Icon className="size-5" aria-hidden />{it.label}
                  </Link>
                );
              })}
            </nav>
            <div className="mt-auto flex flex-col gap-2">
              <p className="text-sm"><span className="font-medium">{userName}</span> · <span className="opacity-80">{role === "owner" ? "Owner" : "Cashier"}</span></p>
              <SignOutButton className="justify-center bg-white text-deep hover:bg-soft" />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
