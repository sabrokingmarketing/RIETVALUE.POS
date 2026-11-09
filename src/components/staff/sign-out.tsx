"use client";
import { useState } from "react";
import { LogOut } from "lucide-react";
import { authClient } from "@/lib/auth-client";

export function SignOutButton({ className = "" }: { className?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button type="button" disabled={busy} className={`inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-medium hover:bg-white/10 ${className}`}
      onClick={async () => { setBusy(true); await authClient.signOut().catch(() => {}); window.location.href = "/login"; }}>
      <LogOut className="size-4" aria-hidden /> Sign out
    </button>
  );
}
