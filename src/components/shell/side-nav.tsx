"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Barcode, Boxes, FileSpreadsheet, LayoutDashboard, Menu, Receipt, Settings, ShoppingCart, Sprout, X } from "lucide-react";
import type { NavItem, NavKey } from "./app-shell";
import { SignOutButton } from "@/components/staff/sign-out";

const ICON: Record<NavKey, typeof Menu> = {
  dashboard: LayoutDashboard, pos: ShoppingCart, products: Sprout, inventory: Boxes, labels: Barcode,
  sales: Receipt, reports: BarChart3, data: FileSpreadsheet, settings: Settings,
};

function isActive(path: string, item: NavItem) {
  return item.match.some((m) => (m.endsWith("$") ? path === m.slice(0, -1) : path === m || path.startsWith(m + "/")));
}

export function SideNav({ items }: { items: NavItem[] }) {
  const path = usePathname();
  return (
    <nav className="flex flex-col gap-1">
      {items.map((it) => {
        const Icon = ICON[it.key]; const active = isActive(path, it);
        return (
          <Link key={it.key} href={it.href} aria-current={active ? "page" : undefined}
            className={`group flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-[11px] font-medium leading-tight lg:flex-row lg:justify-start lg:gap-3 lg:px-3 lg:text-sm ${
              active ? "bg-primary text-ink" : "text-white/90 hover:bg-white/10 hover:text-white"}`}>
            <Icon className="size-5 shrink-0" aria-hidden />
            <span className="text-center lg:text-left">{it.label}</span>
          </Link>
        );
      })}
    </nav>
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
