import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, FilePlus2, FileText, Mail, MailWarning, PenLine, Search, ShoppingCart, Wallet } from "lucide-react";
import { pageActor } from "@/server/session";
import { listInvoices, type InvoiceFilter } from "@/server/invoices";
import { formatRand } from "@/lib/money";
import { invoiceBadge, shortDate } from "@/lib/invoice-format";
import { ButtonLink, PageHeader, cx, inputClass } from "@/components/ui";
import { mailConfigured } from "@/server/mail";

export const metadata: Metadata = { title: "Invoices" };

const FILTERS: [InvoiceFilter, string][] = [["all", "All"], ["draft", "Drafts"], ["unpaid", "Awaiting payment"], ["overdue", "Overdue"], ["paid", "Paid"], ["void", "Void"]];
const tone = { green: "bg-soft text-deep", warn: "bg-warn-bg text-warn", danger: "bg-danger-bg text-danger", neutral: "bg-mist text-muted ring-1 ring-line" };

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ f?: string; q?: string }> }) {
  const actor = await pageActor(["owner"], "/admin/invoices");
  const sp = await searchParams;
  const filter = (FILTERS.find(([k]) => k === sp.f)?.[0] ?? "all") as InvoiceFilter;
  const term = (sp.q ?? "").slice(0, 80);
  const { rows, stats } = await listInvoices(actor, { filter, term });
  const href = (f: InvoiceFilter) => `/admin/invoices?${new URLSearchParams({ ...(f !== "all" ? { f } : {}), ...(term ? { q: term } : {}) })}`;
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Invoices" description="Every invoice from the till and every invoice you make by hand, in one place."
        actions={<ButtonLink href="/admin/invoices/new" size="lg" data-testid="new-invoice"><FilePlus2 className="size-5" aria-hidden /> New invoice</ButtonLink>} />

      {!mailConfigured() && (
        <div className="mb-5 flex items-start gap-3 rounded-2xl border border-warn/30 bg-warn-bg p-4 text-sm">
          <MailWarning className="mt-0.5 size-5 shrink-0 text-warn" aria-hidden />
          <p><strong>E-mail isn&apos;t connected yet.</strong> Invoices are still saved and can be downloaded as PDF. To e-mail them automatically, set <code className="rounded bg-white/70 px-1">SMTP_URL</code> and <code className="rounded bg-white/70 px-1">MAIL_FROM</code> on the server (see the README).</p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {([
          ["Awaiting payment", formatRand(stats.outstanding_cents), `${stats.outstanding_count} invoice${stats.outstanding_count === 1 ? "" : "s"}`, <Wallet key="w" className="size-5" />, "neutral", "stat-outstanding"],
          ["Overdue", formatRand(stats.overdue_cents), `${stats.overdue_count} past due`, <AlertTriangle key="a" className="size-5" />, stats.overdue_count ? "warn" : "neutral", undefined],
          ["Paid this month", formatRand(stats.paid_month_cents), "Till and manual", <CheckCircle2 key="c" className="size-5" />, "green", undefined],
          ["Drafts", String(stats.drafts), "Not sent yet", <PenLine key="p" className="size-5" />, "neutral", undefined],
        ] as const).map(([label, value, sub, icon, t, testId]) => (
          <div key={label} className="card flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:gap-3">
            <span className={cx("inline-flex size-10 shrink-0 items-center justify-center rounded-xl", t === "warn" ? "bg-warn-bg text-warn" : "bg-soft text-deep")} aria-hidden>{icon}</span>
            <div className="min-w-0">
              <p className="text-sm text-muted">{label}</p>
              <p className="tabular mt-0.5 text-xl font-semibold sm:text-2xl" data-testid={testId}>{value}</p>
              <p className="mt-0.5 text-xs text-muted">{sub}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <nav className="flex gap-1 overflow-x-auto rounded-2xl bg-surface p-1 ring-1 ring-line" aria-label="Filter invoices">
          {FILTERS.map(([k, label]) => (
            <Link key={k} href={href(k)} aria-current={filter === k ? "page" : undefined}
              className={cx("inline-flex min-h-10 items-center whitespace-nowrap rounded-xl px-3.5 text-sm font-medium", filter === k ? "bg-deep text-white" : "text-muted hover:bg-soft hover:text-ink")}>
              {label}{k === "draft" && stats.drafts > 0 && <span className={cx("ml-1.5 rounded-full px-1.5 text-xs", filter === k ? "bg-white/20" : "bg-mist")}>{stats.drafts}</span>}
            </Link>
          ))}
        </nav>
        <form role="search" className="relative lg:w-80">
          {filter !== "all" && <input type="hidden" name="f" value={filter} />}
          <label htmlFor="inv-q" className="sr-only">Search invoices</label>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <input id="inv-q" name="q" type="search" defaultValue={term} placeholder="Number, customer, e-mail or reference" className={cx(inputClass, "rounded-full pl-9")} />
        </form>
      </div>

      {rows.length === 0 ? (
        <div className="mt-6 flex flex-col items-center rounded-3xl border border-dashed border-field/50 bg-surface px-6 py-14 text-center">
          <span className="inline-flex size-14 items-center justify-center rounded-2xl bg-soft text-deep"><FileText className="size-7" aria-hidden /></span>
          <p className="mt-4 text-lg font-semibold">{term || filter !== "all" ? "No invoices match" : "No invoices yet"}</p>
          <p className="mt-1 max-w-md text-sm text-muted">{term || filter !== "all" ? "Try another filter or search." : "Invoices appear here when a customer asks for one at the till, or when you make one by hand."}</p>
          {!term && filter === "all" && <ButtonLink href="/admin/invoices/new" className="mt-5"><FilePlus2 className="size-4" aria-hidden /> Make your first invoice</ButtonLink>}
        </div>
      ) : (
        <ul className="mt-4 flex flex-col gap-2" data-testid="invoice-list">
          <li className="hidden grid-cols-[150px_1fr_110px_110px_130px_150px] gap-4 px-5 text-xs font-semibold uppercase tracking-wide text-muted lg:grid" aria-hidden>
            <span>Invoice</span><span>Customer</span><span>Issued</span><span>Due</span><span className="text-right">Amount</span><span>Status</span>
          </li>
          {rows.map((r) => {
            const b = invoiceBadge(r);
            return (
              <li key={r.id}>
                <Link href={`/admin/invoices/${r.id}`} className="card block px-4 py-3.5 transition hover:-translate-y-px hover:border-deep/30 hover:shadow-md lg:grid lg:grid-cols-[150px_1fr_110px_110px_130px_150px] lg:items-center lg:gap-4 lg:px-5 lg:py-4">
                  <span className="flex items-center justify-between gap-3 lg:contents">
                    <span className="flex items-center gap-2 font-semibold">
                      <span className={cx("inline-flex size-8 shrink-0 items-center justify-center rounded-lg", r.source === "sale" ? "bg-soft text-deep" : "bg-mist text-ink")} title={r.source === "sale" ? "From the till" : "Made by hand"}>
                        {r.source === "sale" ? <ShoppingCart className="size-4" aria-hidden /> : <FileText className="size-4" aria-hidden />}
                      </span>
                      <span className="tabular">{r.invoice_no ?? "Draft"}</span>
                    </span>
                    <span className="lg:hidden"><span className={cx("inline-flex rounded-full px-2.5 py-1 text-xs font-semibold", tone[b.tone])}>{b.label}</span></span>
                  </span>
                  <span className="mt-2 flex items-end justify-between gap-3 lg:contents">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{r.bill_company || r.bill_name || "No customer yet"}</span>
                      <span className="flex items-center gap-1 truncate text-xs text-muted">
                        {r.last_email && (r.last_email_status === "sent" ? <Mail className="size-3.5 shrink-0 text-deep" aria-label="E-mailed" /> : <MailWarning className="size-3.5 shrink-0 text-warn" aria-label="Not delivered" />)}
                        <span className="truncate">{r.bill_company && r.bill_name ? r.bill_name : r.bill_email}</span>
                      </span>
                      <span className="mt-0.5 block text-xs text-muted lg:hidden">{shortDate(r.issue_date)}{r.status === "issued" && r.due_date && r.due_date !== r.issue_date ? ` · due ${shortDate(r.due_date)}` : ""}</span>
                    </span>
                    <span className="hidden text-sm lg:block">{shortDate(r.issue_date)}</span>
                    <span className="hidden text-sm lg:block">{r.status === "paid" ? "—" : r.due_date && r.due_date !== r.issue_date ? shortDate(r.due_date) : "On receipt"}</span>
                    <span className="tabular shrink-0 text-right text-base font-semibold">{formatRand(r.total_cents)}</span>
                    <span className="hidden lg:block"><span className={cx("inline-flex rounded-full px-2.5 py-1 text-xs font-semibold", tone[b.tone])}>{b.label}</span></span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
