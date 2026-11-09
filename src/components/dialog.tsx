"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cx } from "./ui";

/** Accessible modal: traps Tab focus, closes on Escape (unless locked), restores focus on close. */
export function Dialog({ open, onClose, title, children, wide, locked, labelledBy = "dialog-title" }:
  { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean; locked?: boolean; labelledBy?: string }) {
  const panel = useRef<HTMLDivElement>(null);
  const restore = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    restore.current = document.activeElement;
    const el = panel.current;
    const first = el?.querySelector<HTMLElement>("[data-autofocus]") ?? el?.querySelector<HTMLElement>("input,button,select,textarea,[href]");
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !locked) { e.preventDefault(); onClose(); }
      if (e.key === "Tab" && el) {
        const f = [...el.querySelectorAll<HTMLElement>("input,button,select,textarea,[href],[tabindex]:not([tabindex='-1'])")].filter((x) => !x.hasAttribute("disabled"));
        if (f.length === 0) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      (restore.current as HTMLElement | null)?.focus?.();
    };
  }, [open, locked, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/50 p-0 sm:items-center sm:p-4" data-dialog-open>
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={labelledBy}
        className={cx("max-h-[100dvh] w-full overflow-y-auto rounded-t-2xl bg-surface p-5 shadow-xl sm:rounded-2xl", wide ? "sm:max-w-3xl" : "sm:max-w-lg")}>
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 id={labelledBy} className="text-xl font-semibold">{title}</h2>
          {!locked && (
            <button type="button" onClick={onClose} className="-m-2 inline-flex size-11 items-center justify-center rounded-lg hover:bg-mist" aria-label="Close">
              <X className="size-5" aria-hidden />
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}
