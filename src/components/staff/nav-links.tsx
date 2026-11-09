"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLinks({ links, variant = "dark" }: { links: { href: string; label: string }[]; variant?: "dark" | "light" }) {
  const path = usePathname();
  return (
    <>
      {links.map((l) => {
        const active = l.href === "/admin" || l.href === "/till" ? path === l.href : path.startsWith(l.href);
        const cls = variant === "dark"
          ? `whitespace-nowrap rounded-lg px-3 min-h-11 inline-flex items-center text-sm font-medium ${active ? "bg-white text-forest" : "hover:bg-white/10"}`
          : `whitespace-nowrap rounded-lg px-3 min-h-11 inline-flex items-center text-sm font-medium ${active ? "bg-leaf text-forest font-semibold" : "text-ink hover:bg-mist"}`;
        return <Link key={l.href} href={l.href} aria-current={active ? "page" : undefined} className={cls}>{l.label}</Link>;
      })}
    </>
  );
}
