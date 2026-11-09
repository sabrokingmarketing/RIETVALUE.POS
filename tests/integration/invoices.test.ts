/**
 * Invoices: from a POS sale (paid, e-mailed with the PDF attached) and made by hand
 * (draft → issued → paid / void), plus the database guards that keep issued invoices fixed.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { closePool, makeCategory, makeUser, onHand, resetDatabase } from "../support/db";
import { createProduct, createVariant } from "@/server/catalog";
import { receiveDelivery } from "@/server/stock";
import { commitSale } from "@/server/checkout";
import { openTill } from "@/server/till";
import { updateInvoiceSettings, updateSettings } from "@/server/settings";
import {
  createInvoiceFromSale, deleteDraft, duplicateInvoice, getInvoice, issueInvoice, listInvoices, markPaid, saveManualInvoice, searchCustomers, voidInvoice,
} from "@/server/invoices";
import { sendInvoiceEmail } from "@/server/invoice-mail";
import { renderInvoicePdf } from "@/server/invoice-pdf";
import { q, q1 } from "@/server/db";
import { todayBusinessDate } from "@/lib/dates";
import type { Actor } from "@/server/session-types";

let owner: Actor, cashier: Actor, variantId: number, saleId: string;
const mailDir = fs.mkdtempSync(path.join(os.tmpdir(), "mail-"));
const mails = () => fs.readdirSync(mailDir).sort().map((f) => JSON.parse(fs.readFileSync(path.join(mailDir, f), "utf8")));

beforeAll(async () => {
  process.env.MAIL_CAPTURE_DIR = mailDir;
  await resetDatabase();
  owner = await makeUser("owner");
  cashier = await makeUser("cashier");
  await updateSettings(owner, { businessName: "Rietvallei Nursery", vatRegistered: true, vatNumber: "4123456789", vatRatePercent: 15, email: "hello@rietvallei.test", phone: "021 555 0101", addressLines: "1 Farm Road\nStellenbosch" });
  await updateInvoiceSettings(owner, { paymentInfo: "FNB · Acc 62000000000 · Branch 250655\nUse the invoice number as reference", termsDays: 14, thanks: "Thank you for growing with us!" });
  const productId = await createProduct(owner, { commonName: "Lavender", botanicalName: "", categoryId: await makeCategory() });
  variantId = await createVariant(owner, productId, { sizeLabel: "15 cm pot", priceCents: 8990, isPublic: true });
  await receiveDelivery(owner, { idempotencyKey: randomUUID(), lines: [{ variantId, quantity: 10, priceCents: 8990 }] });
  await openTill(cashier, { floatCents: 50000 });
  const sale = await commitSale(cashier, { idempotencyKey: randomUUID(), lines: [{ variantId, quantity: 2, unitPriceCents: 8990 }], payment: { method: "card", terminalApproved: true, reference: "AUTH 1234" } });
  saleId = sale.saleId;
});
afterAll(async () => { delete process.env.MAIL_CAPTURE_DIR; await closePool(); });

describe("invoice from a POS sale", () => {
  let invoiceId: string;

  it("creates a paid invoice with the sale's lines and saves the customer", async () => {
    const r = await createInvoiceFromSale(cashier, { saleId, email: "Thandi@Example.com", name: "Thandi Mokoena" });
    expect(r.created).toBe(true);
    invoiceId = r.id;
    const inv = (await getInvoice(cashier, r.id))!;
    expect(inv.invoice_no).toBe("INV-000001");
    expect(inv.status).toBe("paid");
    expect(inv.paid_method).toBe("card");
    expect(inv.total_cents).toBe(17980);
    expect(inv.vat_cents).toBe(2345);
    expect(inv.subtotal_cents).toBe(17980 - 2345);
    expect(inv.lines).toHaveLength(1);
    expect(inv.lines[0]).toMatchObject({ description: "Lavender — 15 cm pot", quantity: 2, unit_price_cents: 8990 });
    expect(inv.bill_email).toBe("thandi@example.com");
    expect(inv.receipt_no).toMatch(/^S\d{6}$/);
    expect(await onHand(variantId)).toBe(8); // invoicing never moves stock
    expect((await searchCustomers(owner, "thandi"))[0]).toMatchObject({ name: "Thandi Mokoena", email: "thandi@example.com" });
  });

  it("is idempotent: a sale only ever has one invoice", async () => {
    const again = await createInvoiceFromSale(cashier, { saleId, email: "thandi@example.com" });
    expect(again).toEqual({ id: invoiceId, created: false });
    expect((await q1<{ n: number }>(`SELECT count(*)::int AS n FROM invoices`))!.n).toBe(1);
  });

  it("e-mails the PDF to the customer and logs it", async () => {
    const res = await sendInvoiceEmail(cashier, invoiceId, { to: "thandi@example.com" });
    expect(res.status).toBe("sent");
    const m = mails().at(-1);
    expect(m.to).toBe("thandi@example.com");
    expect(m.replyTo).toBe("hello@rietvallei.test");
    expect(m.subject).toBe("Tax invoice INV-000001 from Rietvallei Nursery");
    expect(m.html).toContain("R179.80");
    expect(m.text).toContain("paid in full");
    expect(m.attachments[0]).toMatchObject({ filename: "Tax-invoice-INV-000001.pdf", contentType: "application/pdf" });
    const pdf = await PDFDocument.load(Buffer.from(m.attachments[0].base64, "base64"));
    const { width, height } = pdf.getPage(0).getSize();
    expect(Math.round((width * 25.4) / 72)).toBe(210);
    expect(Math.round((height * 25.4) / 72)).toBe(297);
    const inv = (await getInvoice(owner, invoiceId))!;
    expect(inv.emails[0]).toMatchObject({ to_email: "thandi@example.com", status: "sent" });
  });

  it("escapes customer text in the e-mail", async () => {
    const before = mails().length;
    await sendInvoiceEmail(owner, invoiceId, { to: "x@example.com", message: "<script>alert(1)</script>" });
    const m = mails()[before];
    expect(m.html).not.toContain("<script>");
    expect(m.html).toContain("&lt;script&gt;");
  });

  it("rejects a bad address and keeps sale invoices away from void", async () => {
    await expect(sendInvoiceEmail(cashier, invoiceId, { to: "not-an-email" })).rejects.toThrow(/valid e-mail/);
    await expect(voidInvoice(owner, invoiceId, "wrong")).rejects.toThrow(/return/);
  });

  it("reports not_configured when no mail server is set up", async () => {
    const dir = process.env.MAIL_CAPTURE_DIR; delete process.env.MAIL_CAPTURE_DIR;
    try {
      const res = await sendInvoiceEmail(cashier, invoiceId, { to: "thandi@example.com" });
      expect(res.status).toBe("not_configured");
    } finally { process.env.MAIL_CAPTURE_DIR = dir; }
  });
});

describe("manual invoices", () => {
  const today = todayBusinessDate();
  const base = {
    billTo: { name: "Green Thumb Landscaping", company: "Green Thumb (Pty) Ltd", email: "accounts@greenthumb.test", address: "5 Oak Street\nPaarl", vatNumber: "4987654321" },
    issueDate: today, dueDate: "", reference: "PO-778", notes: "Delivered to site.", paymentInfo: "FNB 62000000000",
    lines: [
      { variantId: null as number | null, description: "Garden design consultation", quantity: 1, unitPriceCents: 150000 },
      { variantId: null as number | null, description: "Spekboom 20 cm", sku: "SPK-20", quantity: 12, unitPriceCents: 12500 },
    ],
  };
  let id: string;

  it("saves a draft without a number, then edits it", async () => {
    const r = await saveManualInvoice(owner, null, base);
    id = r.id;
    expect(r.invoiceNo).toBeNull();
    let inv = (await getInvoice(owner, id))!;
    expect(inv.status).toBe("draft");
    expect(inv.total_cents).toBe(150000 + 12 * 12500);
    await saveManualInvoice(owner, id, { ...base, lines: [base.lines[0]] });
    inv = (await getInvoice(owner, id))!;
    expect(inv.lines).toHaveLength(1);
    expect(inv.total_cents).toBe(150000);
    expect(inv.vat_cents).toBe(19565);
  });

  it("validates input", async () => {
    await expect(saveManualInvoice(owner, null, { ...base, lines: [] })).rejects.toThrow(/at least one line/);
    await expect(saveManualInvoice(owner, null, { ...base, billTo: { ...base.billTo, name: "" } })).rejects.toThrow(/customer's name/);
    await expect(saveManualInvoice(owner, null, { ...base, dueDate: "2000-01-01" })).rejects.toThrow(/before the invoice date/);
    await expect(saveManualInvoice(cashier, null, base)).rejects.toThrow(/owner/);
  });

  it("issues with the next number, then locks it", async () => {
    const no = await issueInvoice(owner, id);
    expect(no).toBe("INV-000002");
    await expect(saveManualInvoice(owner, id, base)).rejects.toThrow(/issued/);
    await expect(deleteDraft(owner, id)).rejects.toThrow(/Void/);
    // The database itself refuses changes to an issued invoice's money or lines.
    await expect(q(`UPDATE invoices SET total_cents = 1, subtotal_cents = 1, vat_cents = 0 WHERE id = $1`, [id])).rejects.toThrow(/immutable/);
    await expect(q(`DELETE FROM invoice_lines WHERE invoice_id = $1`, [id])).rejects.toThrow(/cannot change/);
  });

  it("cashiers can't open manual invoices", async () => {
    await expect(getInvoice(cashier, id)).rejects.toThrow(/owner/);
  });

  it("marks paid and shows in the stats", async () => {
    let { stats } = await listInvoices(owner);
    expect(stats.outstanding_cents).toBe(150000);
    await markPaid(owner, id, { method: "eft", date: today, reference: "GT-PAY-1" });
    const inv = (await getInvoice(owner, id))!;
    expect(inv.status).toBe("paid");
    expect(inv.paid_method).toBe("eft");
    ({ stats } = await listInvoices(owner));
    expect(stats.outstanding_cents).toBe(0);
    expect(stats.paid_month_cents).toBeGreaterThanOrEqual(150000);
  });

  it("issues in one step, voids with a reason, and duplicates into a new draft", async () => {
    const r = await saveManualInvoice(owner, null, base, { issue: true });
    expect(r.invoiceNo).toBe("INV-000003");
    await expect(voidInvoice(owner, r.id, "")).rejects.toThrow(/why/);
    await voidInvoice(owner, r.id, "Customer cancelled the order");
    expect((await getInvoice(owner, r.id))!.status).toBe("void");
    const copy = await duplicateInvoice(owner, r.id);
    const d = (await getInvoice(owner, copy))!;
    expect(d.status).toBe("draft");
    expect(d.lines).toHaveLength(2);
    expect(d.due_date! > d.issue_date).toBe(true); // 14-day terms from settings
    const list = await listInvoices(owner, { filter: "void" });
    expect(list.rows.map((x) => x.invoice_no)).toEqual(["INV-000003"]);
    expect((await listInvoices(owner, { term: "greenthumb" })).rows.length).toBeGreaterThanOrEqual(3);
    await deleteDraft(owner, copy);
    expect(await getInvoice(owner, copy)).toBeNull();
  });

  it("renders a multi-page PDF for a long invoice", async () => {
    const lines = Array.from({ length: 40 }, (_, i) => ({ variantId: null, description: `Plant tray ${i + 1} — mixed seedlings in biodegradable pots`, quantity: 1 + (i % 3), unitPriceCents: 4500 }));
    const r = await saveManualInvoice(owner, null, { ...base, lines }, { issue: true });
    const pdf = await renderInvoicePdf((await getInvoice(owner, r.id))!);
    const doc = await PDFDocument.load(pdf);
    expect(doc.getPageCount()).toBeGreaterThan(1);
  });
});
