"use client";
import { useState } from "react";
import { LogOut } from "lucide-react";
import { authClient } from "@/lib/auth-client";

export function SignOutButton({ className = "", compact }: { className?: string; compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  return (
    <button type="button" disabled={busy}
      className={`inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold hover:bg-white/10 disabled:opacity-60 ${className}`}
      onClick={async () => { setBusy(true); await authClient.signOut().catch(() => {}); window.location.href = "/login"; }}>
      <LogOut className="size-4" aria-hidden /> {compact ? <span>Sign out</span> : "Sign out"}
    </button>
  );
}
