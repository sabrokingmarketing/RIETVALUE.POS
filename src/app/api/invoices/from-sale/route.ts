import { api, readJson } from "@/server/http";
import { requireActor } from "@/server/session";
import { createInvoiceFromSale } from "@/server/invoices";
import { sendInvoiceEmail } from "@/server/invoice-mail";
import { q1 } from "@/server/db";

/**
 * POS: turn a completed sale into a saved (paid) invoice and e-mail it to the customer.
 * Safe to repeat — a sale only ever gets one invoice; repeating just re-sends it.
 */
export const POST = api(async (req: Request) => {
  const actor = await requireActor(["owner", "cashier"]);
  const body = (await readJson(req)) as Record<string, unknown>;
  const { id, created } = await createInvoiceFromSale(actor, body as never);
  const inv = await q1<{ invoice_no: string }>(`SELECT invoice_no FROM invoices WHERE id = $1`, [id]);
  const email = await sendInvoiceEmail(actor, id, { to: String(body.email ?? "") });
  return { invoiceId: id, invoiceNo: inv!.invoice_no, created, email };
});
