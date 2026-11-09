import type { Metadata } from "next";
import { pageActor } from "@/server/session";
import { editorContext } from "@/server/invoice-editor-data";
import { InvoiceEditor } from "@/components/invoice/invoice-editor";

export const metadata: Metadata = { title: "New invoice" };

export default async function NewInvoicePage() {
  await pageActor(["owner"], "/admin/invoices/new");
  const ctx = await editorContext();
  return (
    <InvoiceEditor {...ctx} initial={{
      id: null, billTo: { name: "", company: "", email: "", phone: "", address: "", vatNumber: "" },
      issueDate: ctx.today, dueDate: ctx.defaultDue, reference: "", notes: "", paymentInfo: ctx.paymentInfo, lines: [],
    }} />
  );
}
