import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, Loader2 } from "lucide-react";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "danger" | "ghost" | "quiet";
const btn: Record<Variant, string> = {
  primary: "btn-primary bg-forest text-white hover:bg-forest-dark border border-forest",
  secondary: "bg-surface text-ink border border-line hover:bg-leaf hover:border-forest/40",
  danger: "bg-danger text-white border border-danger hover:brightness-95",
  ghost: "bg-transparent text-forest border border-transparent hover:bg-leaf",
  quiet: "bg-mist text-ink border border-line hover:bg-leaf",
};
const sizes = { md: "min-h-11 px-4 text-sm", lg: "min-h-14 px-6 text-lg", xl: "min-h-16 px-6 text-xl" };

export function buttonClass(variant: Variant = "primary", size: keyof typeof sizes = "md", extra?: string) {
  return cx(
    "inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors select-none",
    "disabled:opacity-50 disabled:cursor-not-allowed",
    btn[variant], sizes[size], extra,
  );
}

export function Button({ variant = "primary", size = "md", className, busy, children, ...rest }:
  ComponentProps<"button"> & { variant?: Variant; size?: keyof typeof sizes; busy?: boolean }) {
  return (
    <button className={buttonClass(variant, size, className)} disabled={busy || rest.disabled} aria-busy={busy || undefined} {...rest}>
      {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function ButtonLink({ variant = "primary", size = "md", className, ...rest }:
  ComponentProps<typeof Link> & { variant?: Variant; size?: keyof typeof sizes }) {
  return <Link className={buttonClass(variant, size, className)} {...rest} />;
}

export const inputClass =
  "w-full min-h-11 rounded-lg border border-line bg-surface px-3 text-base text-ink placeholder:text-muted/70 " +
  "focus-visible:outline-3 focus-visible:outline-forest aria-[invalid=true]:border-danger";

export function Field({ label, hint, error, children, htmlFor, className }:
  { label: string; hint?: ReactNode; error?: string; children: ReactNode; htmlFor: string; className?: string }) {
  return (
    <div className={cx("flex flex-col gap-1", className)}>
      <label htmlFor={htmlFor} className="text-sm font-medium">{label}</label>
      {children}
      {hint && !error && <p className="text-xs text-muted">{hint}</p>}
      {error && <p className="text-sm text-danger" role="alert">{error}</p>}
    </div>
  );
}

export function Card({ className, children, ...rest }: ComponentProps<"section">) {
  return <section className={cx("rounded-xl border border-line bg-surface", className)} {...rest}>{children}</section>;
}

export function Alert({ tone = "info", title, children, className }: { tone?: "info" | "success" | "error" | "warn"; title?: string; children?: ReactNode; className?: string }) {
  const styles = {
    info: "bg-leaf border-forest/30 text-ink",
    success: "bg-leaf border-forest text-ink",
    error: "bg-danger-bg border-danger text-danger",
    warn: "bg-warn-bg border-warn/50 text-ink",
  }[tone];
  const Icon = tone === "error" ? AlertTriangle : tone === "warn" ? AlertTriangle : tone === "success" ? CheckCircle2 : Info;
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cx("flex gap-3 rounded-lg border p-3 text-sm", styles, className)}>
      <Icon className="mt-0.5 size-5 shrink-0" aria-hidden />
      <div className="min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={title ? "mt-0.5" : ""}>{children}</div>}
      </div>
    </div>
  );
}

export function Badge({ tone = "neutral", children }: { tone?: "neutral" | "green" | "warn" | "danger"; children: ReactNode }) {
  const s = { neutral: "bg-mist text-ink border-line", green: "bg-leaf text-forest border-forest/30", warn: "bg-warn-bg text-warn border-warn/30", danger: "bg-danger-bg text-danger border-danger/30" }[tone];
  return <span className={cx("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap", s)}>{children}</span>;
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line bg-surface px-6 py-10 text-center">
      <p className="font-semibold">{title}</p>
      {children && <div className="max-w-md text-sm text-muted">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-sm text-muted">
      <Loader2 className="size-4 animate-spin" aria-hidden /> {label}…
    </span>
  );
}

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx("overflow-x-auto rounded-xl border border-line bg-surface", className)}>
      <table className="w-full text-left text-sm">{children}</table>
    </div>
  );
}
export const th = "px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted border-b border-line bg-mist/60";
export const td = "px-3 py-2.5 border-b border-line align-middle";
