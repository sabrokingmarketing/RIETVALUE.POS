"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Ban, Banknote, CheckCircle2, Copy, CreditCard, Download, Landmark, Mail, MoreHorizontal, PenLine, Printer, RotateCcw, Send, Trash2, Wallet, XCircle } from "lucide-react";
import { Dialog } from "@/components/dialog";
import { Alert, Button, cx, inputClass } from "@/components/ui";
import { formatRand } from "@/lib/money";
import {
  deleteDraftAction, duplicateInvoiceAction, emailInvoiceAction, issueInvoiceAction, markPaidAction, markUnpaidAction, voidInvoiceAction,
} from "@/app/admin/invoices/actions";
import type { InvoiceStatusName } from "@/lib/invoice-format";

type Inv = { id: string; status: InvoiceStatusName; source: "sale" | "manual"; invoiceNo: string | null; email: string; total: number; saleId: string | null };
const METHODS = [["eft", "EFT / bank transfer", Landmark], ["cash", "Cash", Banknote], ["card", "Card", CreditCard], ["other", "Other", Wallet]] as const;

/** Toolbar and dialogs on the invoice page: e-mail, download, mark paid, void, duplicate, delete. */
export function InvoiceActions({ inv, mailReady, today }: { inv: Inv; mailReady: boolean; today: string }) {
  const router = useRouter();
  const [dlg, setDlg] = useState<null | "email" | "paid" | "void" | "delete">(null);
  const [menu, setMenu] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "success" | "warn" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const h = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false); };
    const k = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    document.addEventListener("mousedown", h); document.addEventListener("keydown", k);
    return () => { document.removeEventListener("mousedown", h); document.removeEventListener("keydown", k); };
  }, [menu]);

  // form state
  const [to, setTo] = useState(inv.email);
  const [message, setMessage] = useState("");
  const [method, setMethod] = useState<(typeof METHODS)[number][0]>("eft");
  const [paidDate, setPaidDate] = useState(today);
  const [paidRef, setPaidRef] = useState("");
  const [reason, setReason] = useState("");
  const open = (d: typeof dlg) => { setErr(null); setMenu(false); setDlg(d); };
  const close = () => !pending && setDlg(null);

  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string; data?: unknown } | null>, after?: (data: unknown) => void) => start(async () => {
    const r = await fn();
    if (!r || !r.ok) { setErr(r?.error ?? "Something went wrong."); return; }
    setDlg(null); after?.(r.data); router.refresh();
  });

  const sendEmail = () => run(() => emailInvoiceAction(inv.id, to, message), (d) => {
    const res = d as { status: string; to: string; error?: string };
    setNote(res.status === "sent" ? { tone: "success", text: `Sent to ${res.to}.` }
      : res.status === "not_configured" ? { tone: "warn", text: "E-mail isn't set up on the server yet, so nothing was sent. Download the PDF and send it yourself." }
      : { tone: "error", text: res.error ?? "The e-mail could not be sent." });
  });

  const pdf = `/api/invoices/${inv.id}/pdf`;
  const canSend = inv.status === "issued" || inv.status === "paid";
  const item = "flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium hover:bg-soft disabled:opacity-50";

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {inv.status === "draft" && <>
          <Link href={`/admin/invoices/${inv.id}/edit`} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-field/60 bg-surface px-4 text-sm font-semibold hover:bg-soft"><PenLine className="size-4" aria-hidden /> Edit</Link>
          <Button onClick={() => run(() => issueInvoiceAction(inv.id))} busy={pending && !dlg} data-testid="issue-now"><CheckCircle2 className="size-4" aria-hidden /> Issue invoice</Button>
        </>}
        {canSend && <>
          <a href={`${pdf}?download=1`} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-field/60 bg-surface px-4 text-sm font-semibold hover:bg-soft" data-testid="download-pdf"><Download className="size-4" aria-hidden /> PDF</a>
          <a href={pdf} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-field/60 bg-surface px-4 text-sm font-semibold hover:bg-soft"><Printer className="size-4" aria-hidden /> Print</a>
          {inv.status === "issued" && <Button variant="secondary" onClick={() => open("paid")} data-testid="mark-paid"><CheckCircle2 className="size-4" aria-hidden /> Mark as paid</Button>}
          <Button onClick={() => open("email")} data-testid="email-invoice"><Send className="size-4" aria-hidden /> E-mail invoice</Button>
        </>}
        {inv.status !== "void" && (
          <div className="relative" ref={menuRef}>
            <button type="button" onClick={() => setMenu(!menu)} aria-expanded={menu} aria-haspopup="menu" aria-label="More actions"
              className="inline-flex size-11 items-center justify-center rounded-xl border border-field/60 bg-surface hover:bg-soft"><MoreHorizontal className="size-5" aria-hidden /></button>
            {menu && (
              <div role="menu" className="absolute right-0 top-full z-30 mt-2 w-60 rounded-2xl border border-line bg-surface p-1.5 shadow-xl">
                {inv.source === "manual" && <button role="menuitem" className={item} onClick={() => run(() => duplicateInvoiceAction(inv.id), (id) => router.push(`/admin/invoices/${id}/edit`))}><Copy className="size-4 text-deep" aria-hidden /> Duplicate as new draft</button>}
                {inv.status === "paid" && inv.source === "manual" && <button role="menuitem" className={item} onClick={() => run(() => markUnpaidAction(inv.id))}><RotateCcw className="size-4 text-deep" aria-hidden /> Set back to unpaid</button>}
                {inv.status === "draft" && <button role="menuitem" className={cx(item, "text-danger hover:bg-danger-bg")} onClick={() => open("delete")}><Trash2 className="size-4" aria-hidden /> Delete draft</button>}
                {(inv.status === "issued" || inv.status === "paid") && inv.source === "manual" && <button role="menuitem" className={cx(item, "text-danger hover:bg-danger-bg")} onClick={() => open("void")} data-testid="void-open"><Ban className="size-4" aria-hidden /> Void invoice</button>}
                {inv.source === "sale" && inv.saleId && <Link role="menuitem" className={item} href={`/till/receipts/${inv.saleId}`}><RotateCcw className="size-4 text-deep" aria-hidden /> Refund via the till receipt</Link>}
              </div>
            )}
          </div>
        )}
      </div>
      {note && <Alert tone={note.tone} className="max-w-md">{note.text}</Alert>}
      {err && !dlg && <Alert tone="error" className="max-w-md">{err}</Alert>}

      <Dialog open={dlg === "email"} onClose={close} title="E-mail invoice" icon={<Mail className="size-5" />} description={`${inv.invoiceNo} · ${formatRand(inv.total)} · PDF attached`}
        footer={<><Button variant="secondary" onClick={close} disabled={pending}>Cancel</Button><Button onClick={sendEmail} busy={pending} data-testid="send-email"><Send className="size-4" aria-hidden /> Send</Button></>}>
        <form onSubmit={(e) => { e.preventDefault(); sendEmail(); }} className="flex flex-col gap-4">
          {!mailReady && <Alert tone="warn" title="E-mail isn't set up yet">The invoice will be logged but not delivered. Ask your installer to set SMTP_URL, or download the PDF and send it yourself.</Alert>}
          <div className="flex flex-col gap-1"><label htmlFor="inv-to" className="text-sm font-medium">Send to</label>
            <input id="inv-to" type="email" required value={to} onChange={(e) => setTo(e.target.value)} className={inputClass} placeholder="customer@example.com" data-autofocus /></div>
          <div className="flex flex-col gap-1"><label htmlFor="inv-msg" className="text-sm font-medium">Personal message <span className="font-normal text-muted">(optional)</span></label>
            <textarea id="inv-msg" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} className={cx(inputClass, "py-2")} maxLength={1000} placeholder="e.g. Thanks for your order — see you in spring!" /></div>
          {err && <Alert tone="error">{err}</Alert>}
          <button type="submit" hidden />
        </form>
      </Dialog>

      <Dialog open={dlg === "paid"} onClose={close} title="Mark as paid" icon={<CheckCircle2 className="size-5" />} description={`${inv.invoiceNo} · ${formatRand(inv.total)}`}
        footer={<><Button variant="secondary" onClick={close} disabled={pending}>Cancel</Button><Button onClick={() => run(() => markPaidAction(inv.id, { method, date: paidDate, reference: paidRef }))} busy={pending} data-testid="confirm-paid">Mark as paid</Button></>}>
        <fieldset>
          <legend className="text-sm font-medium">How did they pay?</legend>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {METHODS.map(([k, label, Icon]) => (
              <label key={k} className={cx("flex min-h-16 cursor-pointer items-center gap-3 rounded-2xl border p-3 text-sm font-semibold", method === k ? "border-deep bg-soft" : "border-line hover:bg-mist")}>
                <input type="radio" name="method" value={k} checked={method === k} onChange={() => setMethod(k)} className="sr-only" />
                <span className={cx("inline-flex size-9 items-center justify-center rounded-xl", method === k ? "bg-deep text-white" : "bg-mist text-deep")}><Icon className="size-4" aria-hidden /></span>{label}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1"><label htmlFor="paid-date" className="text-sm font-medium">Date received</label>
            <input id="paid-date" type="date" max={today} value={paidDate} onChange={(e) => setPaidDate(e.target.value)} className={inputClass} /></div>
          <div className="flex flex-col gap-1"><label htmlFor="paid-ref" className="text-sm font-medium">Reference <span className="font-normal text-muted">(optional)</span></label>
            <input id="paid-ref" value={paidRef} onChange={(e) => setPaidRef(e.target.value)} className={inputClass} maxLength={60} placeholder="Bank statement ref" /></div>
        </div>
        {err && <Alert tone="error" className="mt-3">{err}</Alert>}
      </Dialog>

      <Dialog open={dlg === "void"} onClose={close} title="Void this invoice?" tone="danger" icon={<XCircle className="size-5" />} description="It stays on record marked VOID and can't be paid. Make a new invoice if something was wrong."
        footer={<><Button variant="secondary" onClick={close} disabled={pending}>Keep it</Button><Button variant="danger" onClick={() => run(() => voidInvoiceAction(inv.id, reason))} busy={pending} data-testid="confirm-void">Void invoice</Button></>}>
        <div className="flex flex-col gap-1"><label htmlFor="void-reason" className="text-sm font-medium">Reason</label>
          <input id="void-reason" value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass} maxLength={300} placeholder="e.g. Customer cancelled the order" data-autofocus /></div>
        {err && <Alert tone="error" className="mt-3">{err}</Alert>}
      </Dialog>

      <Dialog open={dlg === "delete"} onClose={close} title="Delete this draft?" tone="danger" icon={<Trash2 className="size-5" />} description="Drafts were never sent, so nothing is kept."
        footer={<><Button variant="secondary" onClick={close} disabled={pending}>Cancel</Button><Button variant="danger" onClick={() => run(() => deleteDraftAction(inv.id), () => router.push("/admin/invoices"))} busy={pending}>Delete draft</Button></>}>
        {err ? <Alert tone="error">{err}</Alert> : <p className="text-sm text-muted">This can&apos;t be undone.</p>}
      </Dialog>
    </div>
  );
}
