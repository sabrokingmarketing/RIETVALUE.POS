import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckCircle2, CircleDot, FilePlus2, Mail, MailWarning, ShoppingCart, Send, XCircle } from "lucide-react";
import { pageActor } from "@/server/session";
import { getInvoice } from "@/server/invoices";
import { getSettings } from "@/server/settings";
import { mailConfigured } from "@/server/mail";
import { formatDateTime, todayBusinessDate } from "@/lib/dates";
import { formatRand } from "@/lib/money";
import { invoiceBadge, invoiceTitle, PAID_METHODS, shortDate } from "@/lib/invoice-format";
import { InvoiceDocument } from "@/components/invoice/invoice-document";
import { InvoiceActions } from "@/components/invoice/invoice-actions";
import { Alert, cx } from "@/components/ui";

export const metadata: Metadata = { title: "Invoice" };
const tone = { green: "bg-soft text-deep", warn: "bg-warn-bg text-warn", danger: "bg-danger-bg text-danger", neutral: "bg-mist text-muted ring-1 ring-line" };

export default async function InvoicePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ done?: string; mail?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const actor = await pageActor(["owner"], `/admin/invoices/${id}`);
  const inv = await getInvoice(actor, id);
  if (!inv) notFound();
  const settings = await getSettings();
  const badge = invoiceBadge(inv);

  type Ev = { at: string; icon: React.ReactNode; title: string; sub?: string; tone?: "ok" | "bad" };
  const events: Ev[] = [
    { at: inv.created_at, icon: inv.source === "sale" ? <ShoppingCart className="size-4" /> : <FilePlus2 className="size-4" />, title: inv.source === "sale" ? `Created from till sale ${inv.receipt_no}` : "Draft created", sub: inv.created_by_name },
    ...(inv.issued_at && inv.source === "manual" ? [{ at: inv.issued_at, icon: <CircleDot className="size-4" />, title: `Issued as ${inv.invoice_no}` }] : []),
    ...inv.emails.map((e) => ({
      at: e.created_at, icon: e.status === "sent" ? <Mail className="size-4" /> : <MailWarning className="size-4" />,
      title: e.status === "sent" ? `E-mailed to ${e.to_email}` : e.status === "not_configured" ? `Not e-mailed to ${e.to_email}` : `E-mail to ${e.to_email} failed`,
      sub: e.status === "not_configured" ? "E-mail isn't set up on the server" : e.status === "failed" ? "The mail server refused it" : e.sent_by_name ?? undefined, tone: e.status === "sent" ? "ok" as const : "bad" as const,
    })),
    ...(inv.paid_at && inv.source === "manual" ? [{ at: inv.paid_at, icon: <CheckCircle2 className="size-4" />, title: `Paid${inv.paid_method ? ` by ${PAID_METHODS[inv.paid_method].toLowerCase()}` : ""}`, sub: inv.paid_reference || undefined, tone: "ok" as const }] : []),
    ...(inv.voided_at ? [{ at: inv.voided_at, icon: <XCircle className="size-4" />, title: "Voided", sub: inv.void_reason, tone: "bad" as const }] : []),
  ].map((e, i) => ({ ...e, i })).sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime() || b.i - a.i);

  const flash = sp.done === "send"
    ? sp.mail === "sent" ? { tone: "success" as const, text: `${inv.invoice_no} issued and e-mailed to ${inv.bill_email}.` }
      : sp.mail === "not_configured" ? { tone: "warn" as const, text: `${inv.invoice_no} is issued and saved, but e-mail isn't set up on the server yet. Download the PDF and send it yourself.` }
      : { tone: "error" as const, text: `${inv.invoice_no} is issued, but the e-mail could not be sent. Check the address and press “E-mail invoice” to try again.` }
    : sp.done === "issue" ? { tone: "success" as const, text: `${inv.invoice_no} issued. Send it by e-mail or download the PDF.` }
    : sp.done === "draft" ? { tone: "success" as const, text: "Draft saved. It has no number until you issue it." } : null;

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Link href="/admin/invoices" className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl border border-line bg-surface hover:bg-soft" aria-label="Back to invoices"><ArrowLeft className="size-5" aria-hidden /></Link>
          <div>
            <p className="text-sm text-muted">{invoiceTitle(inv)}{inv.source === "sale" ? " · from the till" : ""}</p>
            <h1 className="flex flex-wrap items-center gap-3 text-2xl font-semibold tracking-tight">
              <span className="tabular" data-testid="invoice-no">{inv.invoice_no ?? "Draft invoice"}</span>
              <span className={cx("rounded-full px-3 py-1 text-sm font-semibold", tone[badge.tone])} data-testid="invoice-status">{badge.label}</span>
            </h1>
            <p className="mt-0.5 text-sm text-muted">{inv.bill_company || inv.bill_name} · {formatRand(inv.total_cents)} · {shortDate(inv.issue_date)}</p>
          </div>
        </div>
        <InvoiceActions inv={{ id: inv.id, status: inv.status, source: inv.source, invoiceNo: inv.invoice_no, email: inv.bill_email, total: inv.total_cents, saleId: inv.sale_id }}
          mailReady={mailConfigured()} today={todayBusinessDate()} />
      </div>
      {flash && <Alert tone={flash.tone} className="mb-5">{flash.text}</Alert>}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <InvoiceDocument inv={inv} logoFile={settings.logo_file} />
        <aside className="flex flex-col gap-4">
          <section className="card p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Amount</h2>
            <p className="tabular mt-1 text-3xl font-bold">{formatRand(inv.total_cents)}</p>
            <p className={cx("mt-1 text-sm font-medium", badge.tone === "danger" ? "text-danger" : badge.tone === "green" ? "text-deep" : "text-warn")}>
              {inv.status === "paid" ? `Paid${inv.paid_method ? ` · ${PAID_METHODS[inv.paid_method]}` : ""}` : inv.status === "issued" ? (inv.due_date && inv.due_date !== inv.issue_date ? `Due ${shortDate(inv.due_date)}` : "Due on receipt") : inv.status === "void" ? "Void — not payable" : "Draft — not sent"}
            </p>
            {inv.sale_id && <Link href={`/till/receipts/${inv.sale_id}`} className="mt-3 inline-flex min-h-10 items-center text-sm font-semibold text-deep underline">Open till receipt {inv.receipt_no}</Link>}
          </section>
          <section className="card p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Customer</h2>
            <p className="mt-2 font-semibold">{inv.bill_name}</p>
            {inv.bill_company && <p className="text-sm">{inv.bill_company}</p>}
            {inv.bill_email ? <a href={`mailto:${inv.bill_email}`} className="block break-all text-sm text-deep underline">{inv.bill_email}</a> : <p className="text-sm text-muted">No e-mail address</p>}
            {inv.bill_phone && <a href={`tel:${inv.bill_phone}`} className="block text-sm text-deep underline">{inv.bill_phone}</a>}
          </section>
          <section className="card p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Activity</h2>
            <ol className="mt-3 flex flex-col" data-testid="invoice-activity">
              {events.map((e, i) => (
                <li key={i} className="relative flex gap-3 pb-4 last:pb-0">
                  {i < events.length - 1 && <span className="absolute left-4 top-8 h-[calc(100%-1.75rem)] w-px bg-line" aria-hidden />}
                  <span className={cx("inline-flex size-8 shrink-0 items-center justify-center rounded-full", e.tone === "bad" ? "bg-danger-bg text-danger" : e.tone === "ok" ? "bg-soft text-deep" : "bg-mist text-muted")} aria-hidden>{e.icon}</span>
                  <div className="min-w-0 text-sm"><p className="font-medium">{e.title}</p><p className="text-xs text-muted">{formatDateTime(e.at)}{e.sub ? ` · ${e.sub}` : ""}</p></div>
                </li>
              ))}
            </ol>
            {inv.status !== "draft" && inv.status !== "void" && !inv.emails.length && (
              <p className="mt-3 flex items-center gap-2 rounded-xl bg-mist p-3 text-xs text-muted"><Send className="size-4" aria-hidden /> Not sent yet</p>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
