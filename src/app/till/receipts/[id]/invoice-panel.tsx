"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Mail } from "lucide-react";
import { SaleInvoiceDialog, SaleInvoiceStatus, type SaleInvoiceState } from "@/components/invoice/sale-invoice";

type Existing = { id: string; invoiceNo: string; email: string; lastStatus: string | null } | null;

/** Receipt page: the sale's invoice (if any) with resend, or a button to e-mail one now. */
export function InvoicePanel({ saleId, receiptNo, existing, isOwner }: { saleId: string; receiptNo: string; existing: Existing; isOwner: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<SaleInvoiceState | null>(null);
  return (
    <section className="card mt-4 p-4" aria-labelledby="inv-h">
      <div className="flex items-start gap-3">
        <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-soft text-deep"><FileText className="size-5" aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <h2 id="inv-h" className="font-semibold">Invoice</h2>
          {existing ? (
            <p className="text-sm text-muted">
              {isOwner ? <a className="font-semibold text-deep underline" href={`/admin/invoices/${existing.id}`}>{existing.invoiceNo}</a> : <strong className="text-ink">{existing.invoiceNo}</strong>}
              {existing.email && <> · {existing.lastStatus === "sent" ? "sent to" : "for"} {existing.email}</>}
              {" · "}<a className="font-semibold text-deep underline" href={`/api/invoices/${existing.id}/pdf`} target="_blank" rel="noopener">PDF</a>
            </p>
          ) : <p className="text-sm text-muted">Customer needs a proper invoice? E-mail one — it&apos;s saved under Invoices.</p>}
        </div>
        {!state && (
          <button type="button" onClick={() => setOpen(true)} className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-ink hover:bg-primary-hover" data-testid="receipt-invoice">
            <Mail className="size-4" aria-hidden /> {existing ? "Resend" : "E-mail invoice"}
          </button>
        )}
      </div>
      {state && <div className="mt-3"><SaleInvoiceStatus state={state} onOpen={() => setOpen(true)} /></div>}
      <SaleInvoiceDialog open={open} onClose={() => setOpen(false)} saleId={saleId} receiptNo={receiptNo}
        initial={existing ? { email: existing.email, name: "" } : undefined} onDone={(s) => { setState(s); router.refresh(); }} />
    </section>
  );
}
