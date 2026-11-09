import Link from "next/link";
import { Sprout } from "lucide-react";
import type { Actor } from "@/server/session-types";
import { SignOutButton } from "./sign-out";
import { NavLinks } from "./nav-links";

/** Top bar shared by the till and the owner workspace. */
export function StaffBar({ actor, businessName, tillOpen }: { actor: Actor; businessName: string; tillOpen?: boolean }) {
  const links = [
    { href: "/till", label: "Till" },
    { href: "/till/receipts", label: "Receipts" },
    { href: "/till/cash", label: "Cash up" },
    ...(actor.role === "owner" ? [{ href: "/admin", label: "Owner workspace" }] : [{ href: "/till/labels", label: "Print labels" }]),
  ];
  return (
    <header className="on-dark no-print sticky top-0 z-40 bg-forest text-white">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-1.5">
        <Link href="/till" className="mr-auto flex min-h-11 items-center gap-2 rounded-lg px-2 font-semibold md:mr-2">
          <Sprout className="size-5" aria-hidden /> <span className="max-w-[12rem] truncate">{businessName}</span>
        </Link>
        <nav aria-label="Staff" className="order-last -mx-1 flex w-full min-w-0 gap-1 overflow-x-auto md:order-none md:mx-0 md:w-auto md:flex-1">
          <NavLinks links={links} />
        </nav>
        {tillOpen !== undefined && (
          <span className={`hidden whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold sm:inline ${tillOpen ? "bg-leaf text-forest" : "bg-warn-bg text-warn"}`}>
            {tillOpen ? "Till open" : "Till closed"}
          </span>
        )}
        <span className="hidden text-sm opacity-90 md:inline">{actor.name} · {actor.role === "owner" ? "Owner" : "Cashier"}</span>
        <SignOutButton />
      </div>
    </header>
  );
}
