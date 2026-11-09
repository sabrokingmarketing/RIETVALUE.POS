import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { pageActor } from "@/server/session";
import { getInvoice } from "@/server/invoices";
import { editorContext } from "@/server/invoice-editor-data";
import { InvoiceEditor } from "@/components/invoice/invoice-editor";

export const metadata: Metadata = { title: "Edit invoice" };

export default async function EditInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await pageActor(["owner"], `/admin/invoices/${id}/edit`);
  const inv = await getInvoice(actor, id);
  if (!inv) notFound();
  if (inv.status !== "draft") redirect(`/admin/invoices/${id}`);
  const ctx = await editorContext();
  return (
    <InvoiceEditor {...ctx} initial={{
      id, billTo: { name: inv.bill_name, company: inv.bill_company, email: inv.bill_email, phone: inv.bill_phone, address: inv.bill_address, vatNumber: inv.bill_vat_number },
      issueDate: inv.issue_date, dueDate: inv.due_date ?? "", reference: inv.reference, notes: inv.notes, paymentInfo: inv.payment_info,
      lines: inv.lines.map((l) => ({ variantId: l.variant_id, description: l.description, sku: l.sku, quantity: l.quantity, unitPriceCents: l.unit_price_cents })),
    }} />
  );
}
