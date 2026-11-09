"use client";
import { useEffect } from "react";
import { Printer } from "lucide-react";
import { buttonClass } from "@/components/ui";

export function PrintControls({ auto, backHref }: { auto: boolean; backHref: string }) {
  useEffect(() => { if (auto) { const t = setTimeout(() => window.print(), 300); return () => clearTimeout(t); } }, [auto]);
  return (
    <div className="no-print flex flex-wrap gap-2 border-b border-line bg-mist p-3">
      <button type="button" className={buttonClass("primary")} onClick={() => window.print()}><Printer className="size-4" aria-hidden /> Print</button>
      <a className={buttonClass("secondary")} href={backHref}>Back</a>
      <p className="self-center text-xs text-muted">If nothing prints, check the printer is on and has paper, then press Print again. This is the original receipt — printing again never changes the sale.</p>
    </div>
  );
}
