"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cx } from "./ui";

/**
 * Accessible modal: traps Tab focus, closes on Escape or backdrop click (unless locked),
 * restores focus on close. Centered card on larger screens, bottom sheet on phones.
 * Focus is set once when it opens — never on re-render — so typing is never interrupted.
 */
export function Dialog({ open, onClose, title, description, icon, tone = "default", footer, children, wide, locked, labelledBy = "dialog-title" }: {
  open: boolean; onClose: () => void; title: string; description?: ReactNode; icon?: ReactNode; tone?: "default" | "danger" | "warn";
  footer?: ReactNode; children: ReactNode; wide?: boolean; locked?: boolean; labelledBy?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const restore = useRef<Element | null>(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  const lockedRef = useRef(locked); lockedRef.current = locked;

  useEffect(() => {
    if (!open) return;
    restore.current = document.activeElement;
    const el = panel.current;
    const first = el?.querySelector<HTMLElement>("[data-autofocus]") ?? el?.querySelector<HTMLElement>(".dialog-body input,.dialog-body select,.dialog-body textarea,.dialog-body button") ?? el?.querySelector<HTMLElement>("button");
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !lockedRef.current) { e.preventDefault(); closeRef.current(); }
      if (e.key === "Tab" && el) {
        const f = [...el.querySelectorAll<HTMLElement>("input,button,select,textarea,[href],[tabindex]:not([tabindex='-1'])")].filter((x) => !x.hasAttribute("disabled"));
        if (f.length === 0) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      (restore.current as HTMLElement | null)?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  const toneCls = tone === "danger" ? "bg-danger-bg text-danger" : tone === "warn" ? "bg-warn-bg text-warn" : "bg-soft text-deep";
  return (
    <div className="dialog-backdrop fixed inset-0 z-50 flex items-end justify-center bg-ink/45 backdrop-blur-[3px] sm:items-center sm:p-6" data-dialog-open
      onMouseDown={(e) => { if (e.target === e.currentTarget && !locked) onClose(); }}>
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={labelledBy}
        className={cx("dialog-panel flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[28px] bg-surface shadow-[0_24px_64px_rgb(23_33_27/0.28)] sm:rounded-[24px]",
          wide ? "sm:max-w-3xl" : "sm:max-w-[520px]")}>
        <div className="mx-auto mt-2.5 h-1.5 w-10 shrink-0 rounded-full bg-line sm:hidden" aria-hidden />
        <header className="flex items-start gap-3 px-5 pb-3 pt-4 sm:px-6 sm:pt-6">
          {icon && <span className={cx("inline-flex size-11 shrink-0 items-center justify-center rounded-2xl", toneCls)} aria-hidden>{icon}</span>}
          <div className="min-w-0 flex-1">
            <h2 id={labelledBy} className="text-xl font-semibold tracking-tight">{title}</h2>
            {description && <div className="mt-0.5 text-sm text-muted">{description}</div>}
          </div>
          {!locked && (
            <button type="button" onClick={onClose} aria-label="Close"
              className="-mr-1 -mt-1 inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-mist hover:text-ink">
              <X className="size-5" aria-hidden />
            </button>
          )}
        </header>
        <div className="dialog-body min-h-0 flex-1 overflow-y-auto px-5 pb-5 sm:px-6 sm:pb-6">{children}</div>
        {footer && <footer className="flex flex-col-reverse gap-2 border-t border-line bg-mist/60 px-5 py-4 sm:flex-row sm:justify-end sm:px-6">{footer}</footer>}
      </div>
    </div>
  );
}
