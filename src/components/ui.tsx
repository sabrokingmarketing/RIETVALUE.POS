import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, Loader2 } from "lucide-react";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "danger" | "ghost" | "quiet";
const btn: Record<Variant, string> = {
  primary: "btn-primary bg-primary text-ink border border-primary hover:bg-primary-hover hover:border-primary-hover shadow-sm",
  secondary: "bg-surface text-ink border border-field/60 hover:bg-soft hover:border-deep/40",
  danger: "bg-danger text-white border border-danger hover:brightness-95",
  ghost: "bg-transparent text-deep border border-transparent hover:bg-soft",
  quiet: "bg-mist text-ink border border-line hover:bg-soft",
};
const sizes = { md: "min-h-11 px-4 text-sm", lg: "min-h-14 px-6 text-lg", xl: "min-h-16 px-6 text-xl" };

export function buttonClass(variant: Variant = "primary", size: keyof typeof sizes = "md", extra?: string) {
  return cx(
    "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors select-none",
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
  "w-full min-h-11 rounded-xl border border-field bg-surface px-3 text-base text-ink placeholder:text-muted " +
  "focus-visible:outline-3 focus-visible:outline-deep aria-[invalid=true]:border-danger disabled:bg-mist disabled:text-muted";

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
  return <section className={cx("card", className)} {...rest}>{children}</section>;
}

export function Alert({ tone = "info", title, children, className }: { tone?: "info" | "success" | "error" | "warn"; title?: string; children?: ReactNode; className?: string }) {
  const styles = {
    info: "bg-info-bg border-[#9cc3ea] text-ink",
    success: "bg-soft border-deep/40 text-ink",
    error: "bg-danger-bg border-danger text-danger",
    warn: "bg-warn-bg border-warn/50 text-ink",
  }[tone];
  const Icon = tone === "error" ? AlertTriangle : tone === "warn" ? AlertTriangle : tone === "success" ? CheckCircle2 : Info;
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cx("flex gap-3 rounded-xl border p-3 text-sm", styles, className)}>
      <Icon className="mt-0.5 size-5 shrink-0" aria-hidden />
      <div className="min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={title ? "mt-0.5" : ""}>{children}</div>}
      </div>
    </div>
  );
}

export function Badge({ tone = "neutral", children }: { tone?: "neutral" | "green" | "warn" | "danger"; children: ReactNode }) {
  const s = { neutral: "bg-mist text-ink border-line", green: "bg-soft text-deep border-deep/25", warn: "bg-warn-bg text-warn border-warn/30", danger: "bg-danger-bg text-danger border-danger/30" }[tone];
  return <span className={cx("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap", s)}>{children}</span>;
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-field/50 bg-surface px-6 py-10 text-center">
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
    <div className={cx("card relative overflow-x-auto", className)}>
      <table className="w-full text-left text-sm">{children}</table>
    </div>
  );
}
export const th = "px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted border-b border-line bg-mist/70 whitespace-nowrap";
export const td = "px-4 py-3 border-b border-line align-middle";

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("skeleton", className)} aria-hidden />;
}

export function StatTile({ label, value, sub, icon, tone = "neutral", testId }: { label: string; value: ReactNode; sub?: ReactNode; icon?: ReactNode; tone?: "neutral" | "green" | "warn"; testId?: string }) {
  return (
    <div className="card flex items-start gap-3 p-4">
      {icon && <span className={cx("inline-flex size-10 shrink-0 items-center justify-center rounded-xl", tone === "warn" ? "bg-warn-bg text-warn" : "bg-soft text-deep")} aria-hidden>{icon}</span>}
      <div className="min-w-0">
        <p className="text-sm text-muted">{label}</p>
        <p className="tabular mt-0.5 truncate text-2xl font-semibold" data-testid={testId}>{value}</p>
        {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
      </div>
    </div>
  );
}

export function Tabs({ items }: { items: { href: string; label: string; active: boolean }[] }) {
  return (
    <nav className="mb-5 flex gap-1 overflow-x-auto rounded-2xl bg-surface p-1 ring-1 ring-line" aria-label="Section">
      {items.map((t) => (
        <Link key={t.href} href={t.href} aria-current={t.active ? "page" : undefined}
          className={cx("inline-flex min-h-11 items-center whitespace-nowrap rounded-xl px-4 text-sm font-medium", t.active ? "bg-primary text-ink font-semibold" : "text-muted hover:bg-soft hover:text-ink")}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
