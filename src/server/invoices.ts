import "server-only";
import { z } from "zod";
import { BUSINESS_DATE_SQL, q, q1, tx, type Db } from "./db";
import { AppError } from "./errors";
import { assertRole, type Actor } from "./session-types";
import { nextNumber } from "./stock";
import { getSettings, type Settings } from "./settings";
import { vatIncluded } from "@/lib/money";
import { isYmd } from "@/lib/dates";
import { audit } from "./audit";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type InvoiceStatus = "draft" | "issued" | "paid" | "void";
export type BusinessSnapshot = {
  business_name: string; legal_name: string; registration_no: string; vat_number: string; address_lines: string;
  phone: string; email: string; vat_rate_bp: number; thanks: string;
};
export type InvoiceLine = {
  line_no: number; variant_id: number | null; description: string; sku: string; quantity: number;
  unit_price_cents: number; line_total_cents: number; vat_rate_bp: number; vat_cents: number;
};
export type InvoiceEmail = { id: number; to_email: string; status: "sent" | "failed" | "not_configured"; error: string; created_at: string; sent_by_name: string | null };
export type Invoice = {
  id: string; invoice_no: string | null; source: "sale" | "manual"; sale_id: string | null; receipt_no: string | null;
  status: InvoiceStatus; customer_id: number | null;
  bill_name: string; bill_company: string; bill_email: string; bill_phone: string; bill_address: string; bill_vat_number: string;
  issue_date: string; due_date: string | null; reference: string; notes: string; payment_info: string;
  subtotal_cents: number; vat_cents: number; total_cents: number; vat_registered: boolean; business_snapshot: BusinessSnapshot;
  paid_at: string | null; paid_method: "" | "cash" | "card" | "eft" | "other"; paid_reference: string; void_reason: string;
  created_at: string; issued_at: string | null; voided_at: string | null; created_by_name: string;
  lines: InvoiceLine[]; emails: InvoiceEmail[];
};

export { PAID_METHODS, invoiceTitle } from "@/lib/invoice-format";
export const isOverdue = (inv: Pick<Invoice, "status" | "due_date">, today: string) => inv.status === "issued" && !!inv.due_date && inv.due_date < today;

function snapshot(s: Settings): BusinessSnapshot {
  return {
    business_name: s.business_name, legal_name: s.legal_name, registration_no: s.registration_no,
    vat_number: s.vat_registered ? s.vat_number : "", address_lines: s.address_lines, phone: s.phone, email: s.email,
    vat_rate_bp: s.vat_registered ? s.vat_rate_bp : 0, thanks: s.invoice_thanks,
  };
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------
const INVOICE_COLS = `i.id, i.invoice_no, i.source, i.sale_id, s.receipt_no, i.status, i.customer_id, i.bill_name, i.bill_company, i.bill_email,
  i.bill_phone, i.bill_address, i.bill_vat_number, i.issue_date, i.due_date, i.reference, i.notes, i.payment_info, i.subtotal_cents,
  i.vat_cents, i.total_cents, i.vat_registered, i.business_snapshot, i.paid_at, i.paid_method, i.paid_reference, i.void_reason,
  i.created_at, i.issued_at, i.voided_at, u.name AS created_by_name`;

export async function getInvoice(actor: Actor, id: string, db?: Db): Promise<Invoice | null> {
  assertRole(actor, ["owner", "cashier"]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const inv = await q1<Omit<Invoice, "lines" | "emails">>(
    `SELECT ${INVOICE_COLS} FROM invoices i JOIN "user" u ON u.id = i.created_by LEFT JOIN sales s ON s.id = i.sale_id WHERE i.id = $1`, [id], db);
  if (!inv) return null;
  // Cashiers may only see invoices made from POS sales.
  if (actor.role !== "owner" && inv.source !== "sale") throw new AppError("FORBIDDEN", "Only the owner can open this invoice.");
  const lines = await q<InvoiceLine>(
    `SELECT line_no, variant_id, description, sku, quantity, unit_price_cents, line_total_cents, vat_rate_bp, vat_cents
     FROM invoice_lines WHERE invoice_id = $1 ORDER BY line_no`, [id], db);
  const emails = await q<InvoiceEmail>(
    `SELECT e.id, e.to_email, e.status, e.error, e.created_at, u.name AS sent_by_name FROM invoice_emails e
     LEFT JOIN "user" u ON u.id = e.sent_by WHERE e.invoice_id = $1 ORDER BY e.created_at DESC, e.id DESC`, [id], db);
  return { ...inv, lines, emails };
}

export async function invoiceForSale(actor: Actor, saleId: string, db?: Db) {
  assertRole(actor, ["owner", "cashier"]);
  if (!/^[0-9a-f-]{36}$/i.test(saleId)) return null;
  const r = await q1<{ id: string }>(`SELECT id FROM invoices WHERE sale_id = $1`, [saleId], db);
  return r ? getInvoice(actor, r.id, db) : null;
}

export type InvoiceFilter = "all" | "draft" | "unpaid" | "overdue" | "paid" | "void";
export type InvoiceRow = Pick<Invoice, "id" | "invoice_no" | "source" | "status" | "bill_name" | "bill_company" | "bill_email" | "issue_date" | "due_date" | "total_cents" | "created_at"> & { last_email: string | null; last_email_status: string | null };

export async function listInvoices(actor: Actor, opts: { filter?: InvoiceFilter; term?: string; limit?: number } = {}, db?: Db) {
  assertRole(actor, ["owner"]);
  const filter = opts.filter ?? "all";
  const term = (opts.term ?? "").trim().slice(0, 80);
  const where = {
    all: "true", draft: "i.status = 'draft'", unpaid: "i.status = 'issued'", paid: "i.status = 'paid'", void: "i.status = 'void'",
    overdue: `i.status = 'issued' AND i.due_date < ${BUSINESS_DATE_SQL}`,
  }[filter];
  const rows = await q<InvoiceRow>(
    `SELECT i.id, i.invoice_no, i.source, i.status, i.bill_name, i.bill_company, i.bill_email, i.issue_date, i.due_date, i.total_cents, i.created_at,
            e.to_email AS last_email, e.status AS last_email_status
     FROM invoices i
     LEFT JOIN LATERAL (SELECT to_email, status FROM invoice_emails WHERE invoice_id = i.id ORDER BY created_at DESC, id DESC LIMIT 1) e ON true
     WHERE ${where}
       AND ($1 = '' OR i.invoice_no ILIKE '%' || $1 || '%' OR i.bill_name ILIKE '%' || $1 || '%' OR i.bill_company ILIKE '%' || $1 || '%'
            OR i.bill_email ILIKE '%' || $1 || '%' OR i.reference ILIKE '%' || $1 || '%')
     ORDER BY (i.status = 'draft') DESC, i.issue_date DESC, i.created_at DESC LIMIT $2`,
    [term, Math.min(opts.limit ?? 100, 300)], db);
  const stats = await q1<{ outstanding_cents: number; outstanding_count: number; overdue_cents: number; overdue_count: number; paid_month_cents: number; drafts: number }>(
    `SELECT coalesce(sum(total_cents) FILTER (WHERE status = 'issued'), 0) AS outstanding_cents,
            count(*) FILTER (WHERE status = 'issued') AS outstanding_count,
            coalesce(sum(total_cents) FILTER (WHERE status = 'issued' AND due_date < ${BUSINESS_DATE_SQL}), 0) AS overdue_cents,
            count(*) FILTER (WHERE status = 'issued' AND due_date < ${BUSINESS_DATE_SQL}) AS overdue_count,
            coalesce(sum(total_cents) FILTER (WHERE status = 'paid' AND (paid_at AT TIME ZONE 'Africa/Johannesburg')::date >= date_trunc('month', ${BUSINESS_DATE_SQL})::date), 0) AS paid_month_cents,
            count(*) FILTER (WHERE status = 'draft') AS drafts
     FROM invoices`, [], db);
  return { rows, stats: stats! };
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------
export type Customer = { id: number; name: string; email: string; phone: string; company: string; vat_number: string; address: string };

export async function searchCustomers(actor: Actor, term: string, db?: Db): Promise<Customer[]> {
  assertRole(actor, ["owner", "cashier"]);
  const t = term.trim().slice(0, 80);
  if (t.length < 2) return [];
  return q<Customer>(
    `SELECT id, name, email, phone, company, vat_number, address FROM customers
     WHERE name ILIKE '%' || $1 || '%' OR email ILIKE '%' || $1 || '%' OR company ILIKE '%' || $1 || '%' OR phone ILIKE '%' || $1 || '%'
     ORDER BY (lower(name) LIKE lower($1) || '%') DESC, updated_at DESC LIMIT 8`, [t], db);
}

const email = z.string().trim().toLowerCase().max(200).email("Enter a valid e-mail address");
const optEmail = z.union([z.literal(""), email]).default("");
const txt = (max: number) => z.string().trim().max(max).default("");

const billTo = z.object({
  name: z.string().trim().min(1, "Enter the customer's name").max(120),
  company: txt(120), email: optEmail, phone: txt(40), address: txt(400),
  vatNumber: z.string().trim().max(20).regex(/^[0-9A-Za-z ]*$/, "VAT number: letters and digits only").default(""),
});
type BillTo = z.output<typeof billTo>;

/** Find-or-create a customer by e-mail (or by exact name when there is no e-mail) and refresh their details. */
async function upsertCustomer(c: Db, b: BillTo): Promise<number> {
  const existing = b.email
    ? await q1<{ id: number }>(`SELECT id FROM customers WHERE lower(email) = lower($1)`, [b.email], c)
    : await q1<{ id: number }>(`SELECT id FROM customers WHERE email = '' AND lower(name) = lower($1) ORDER BY id LIMIT 1`, [b.name], c);
  if (existing) {
    await q(`UPDATE customers SET name=$2, company=CASE WHEN $3 <> '' THEN $3 ELSE company END, phone=CASE WHEN $4 <> '' THEN $4 ELSE phone END,
               address=CASE WHEN $5 <> '' THEN $5 ELSE address END, vat_number=CASE WHEN $6 <> '' THEN $6 ELSE vat_number END, updated_at=now() WHERE id=$1`,
      [existing.id, b.name, b.company, b.phone, b.address, b.vatNumber], c);
    return existing.id;
  }
  const r = await q1<{ id: number }>(
    `INSERT INTO customers (name, email, phone, company, vat_number, address) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [b.name, b.email, b.phone, b.company, b.vatNumber, b.address], c);
  return r!.id;
}

// ---------------------------------------------------------------------------
// Invoice from a POS sale
// ---------------------------------------------------------------------------
export const saleInvoiceInput = z.object({
  saleId: z.string().uuid(),
  name: z.string().trim().max(120).default(""),
  email,
  company: txt(120), phone: txt(40), address: txt(400),
  vatNumber: z.string().trim().max(20).regex(/^[0-9A-Za-z ]*$/, "VAT number: letters and digits only").default(""),
});

/**
 * Creates the (already paid) invoice for a completed POS sale. Idempotent: a sale has at most one
 * invoice, so calling again returns the existing one. Never touches stock or the sale itself.
 */
export async function createInvoiceFromSale(actor: Actor, input: z.input<typeof saleInvoiceInput>): Promise<{ id: string; created: boolean }> {
  assertRole(actor, ["owner", "cashier"]);
  const r = saleInvoiceInput.safeParse(input);
  if (!r.success) throw new AppError("VALIDATION", r.error.issues[0].message);
  const v = r.data;
  return tx(async (c) => {
    await c.query(`SELECT pg_advisory_xact_lock(hashtext('invoice-sale:' || $1))`, [v.saleId]);
    const existing = await q1<{ id: string }>(`SELECT id FROM invoices WHERE sale_id = $1`, [v.saleId], c);
    if (existing) return { id: existing.id, created: false };
    const sale = await q1<{ id: string; receipt_no: string; business_date: string; created_at: string; total_cents: number; vat_cents: number; vat_registered: boolean; business_snapshot: Omit<BusinessSnapshot, "thanks"> & { receipt_footer: string } }>(
      `SELECT id, receipt_no, business_date, created_at, total_cents, vat_cents, vat_registered, business_snapshot FROM sales WHERE id = $1`, [v.saleId], c);
    if (!sale) throw new AppError("NOT_FOUND", "That sale was not found.");
    const pay = await q1<{ method: "cash" | "card"; reference: string }>(`SELECT method, reference FROM payments WHERE sale_id = $1 AND direction = 'in'`, [v.saleId], c);
    const settings = await getSettings(c);
    const name = v.name || v.email;
    const customerId = await upsertCustomer(c, { name, email: v.email, company: v.company, phone: v.phone, address: v.address, vatNumber: v.vatNumber });
    const no = await nextNumber(c, "invoice", "INV-");
    const snap: BusinessSnapshot = {
      business_name: sale.business_snapshot.business_name, legal_name: sale.business_snapshot.legal_name,
      registration_no: sale.business_snapshot.registration_no, vat_number: sale.business_snapshot.vat_number,
      address_lines: sale.business_snapshot.address_lines, phone: sale.business_snapshot.phone, email: sale.business_snapshot.email,
      vat_rate_bp: sale.business_snapshot.vat_rate_bp, thanks: settings.invoice_thanks,
    };
    const inv = await q1<{ id: string }>(
      `INSERT INTO invoices (invoice_no, source, sale_id, status, customer_id, bill_name, bill_company, bill_email, bill_phone, bill_address, bill_vat_number,
         issue_date, due_date, reference, payment_info, subtotal_cents, vat_cents, total_cents, vat_registered, business_snapshot,
         paid_at, paid_method, paid_reference, created_by)
       VALUES (NULL,'sale',$1,'draft',$2,$3,$4,$5,$6,$7,$8,$9,$9,$10,'',$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING id`,
      [sale.id, customerId, name, v.company, v.email, v.phone, v.address, v.vatNumber, sale.business_date, `Receipt ${sale.receipt_no}`,
        sale.total_cents - sale.vat_cents, sale.vat_cents, sale.total_cents, sale.vat_registered, JSON.stringify(snap),
        sale.created_at, pay?.method ?? "other", pay?.reference ?? "", actor.id], c);
    await c.query(
      `INSERT INTO invoice_lines (invoice_id, line_no, variant_id, description, sku, quantity, unit_price_cents, line_total_cents, vat_rate_bp, vat_cents)
       SELECT $1, line_no, variant_id, description, sku, quantity, unit_price_cents, line_total_cents, vat_rate_bp, vat_cents FROM sale_lines WHERE sale_id = $2`,
      [inv!.id, sale.id]);
    // Lines go in while the row is still a draft; then it is numbered and locked as paid.
    await q(`UPDATE invoices SET invoice_no=$2, status='paid', issued_at=now() WHERE id=$1`, [inv!.id, no], c);
    await audit(c, actor, "invoice.from_sale", "invoice", inv!.id, { invoiceNo: no, saleId: sale.id, email: v.email });
    return { id: inv!.id, created: true };
  });
}

// ---------------------------------------------------------------------------
// Manual invoices
// ---------------------------------------------------------------------------
const manualLine = z.object({
  variantId: z.coerce.number().int().positive().nullable().default(null),
  description: z.string().trim().min(1, "Every line needs a description").max(200),
  sku: txt(40),
  quantity: z.coerce.number().int("Quantities are whole numbers").min(1, "Quantity must be at least 1").max(99999),
  unitPriceCents: z.coerce.number().int().min(0, "Prices can't be negative").max(100_000_000),
});
export const manualInvoiceInput = z.object({
  billTo,
  issueDate: z.string().refine(isYmd, "Choose the invoice date"),
  dueDate: z.union([z.literal(""), z.string().refine(isYmd, "Choose a valid due date")]).default(""),
  reference: txt(80), notes: txt(1000), paymentInfo: txt(600),
  lines: z.array(manualLine).min(1, "Add at least one line").max(100, "At most 100 lines"),
}).superRefine((v, ctx) => {
  if (v.dueDate && v.dueDate < v.issueDate) ctx.addIssue({ code: "custom", path: ["dueDate"], message: "The due date can't be before the invoice date" });
  if (v.lines.reduce((s, l) => s + l.quantity * l.unitPriceCents, 0) > 2_000_000_000) ctx.addIssue({ code: "custom", path: ["lines"], message: "The invoice total is too large" });
});
export type ManualInvoiceInput = z.input<typeof manualInvoiceInput>;

function parseManual(input: unknown) {
  const r = manualInvoiceInput.safeParse(input);
  if (!r.success) throw new AppError("VALIDATION", r.error.issues[0].message, { path: r.error.issues[0].path.join(".") });
  return r.data;
}

async function writeDraft(c: Db, id: string, v: z.output<typeof manualInvoiceInput>, settings: Settings) {
  const rate = settings.vat_registered ? settings.vat_rate_bp : 0;
  const lines = v.lines.map((l, i) => {
    const total = l.unitPriceCents * l.quantity;
    return { ...l, lineNo: i + 1, total, vat: vatIncluded(total, rate) };
  });
  const total = lines.reduce((s, l) => s + l.total, 0);
  const vat = lines.reduce((s, l) => s + l.vat, 0);
  const customerId = await upsertCustomer(c, v.billTo);
  await q(
    `UPDATE invoices SET customer_id=$2, bill_name=$3, bill_company=$4, bill_email=$5, bill_phone=$6, bill_address=$7, bill_vat_number=$8,
       issue_date=$9, due_date=$10, reference=$11, notes=$12, payment_info=$13, subtotal_cents=$14, vat_cents=$15, total_cents=$16,
       vat_registered=$17, business_snapshot=$18, updated_at=now() WHERE id=$1 AND status='draft'`,
    [id, customerId, v.billTo.name, v.billTo.company, v.billTo.email, v.billTo.phone, v.billTo.address, v.billTo.vatNumber,
      v.issueDate, v.dueDate || null, v.reference, v.notes, v.paymentInfo, total - vat, vat, total, settings.vat_registered,
      JSON.stringify(snapshot(settings))], c);
  await q(`DELETE FROM invoice_lines WHERE invoice_id = $1`, [id], c);
  for (const l of lines) {
    await q(
      `INSERT INTO invoice_lines (invoice_id, line_no, variant_id, description, sku, quantity, unit_price_cents, line_total_cents, vat_rate_bp, vat_cents)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id, l.lineNo, l.variantId, l.description, l.sku, l.quantity, l.unitPriceCents, l.total, rate, l.vat], c);
  }
}

/** Create or update a draft. Pass `issue: true` to give it a number and lock it in the same step. */
export async function saveManualInvoice(actor: Actor, id: string | null, input: unknown, opts: { issue?: boolean } = {}): Promise<{ id: string; invoiceNo: string | null }> {
  assertRole(actor, ["owner"]);
  const v = parseManual(input);
  const variantIds = v.lines.map((l) => l.variantId).filter((x): x is number => x !== null);
  return tx(async (c) => {
    if (variantIds.length) {
      const found = await q<{ id: number }>(`SELECT id FROM variants WHERE id = ANY($1::int[])`, [variantIds], c);
      if (found.length !== new Set(variantIds).size) throw new AppError("VALIDATION", "A catalogue item on this invoice no longer exists. Remove it and add it again.");
    }
    const settings = await getSettings(c);
    let invId = id;
    if (invId) {
      const cur = await q1<{ status: InvoiceStatus }>(`SELECT status FROM invoices WHERE id = $1 FOR UPDATE`, [invId], c);
      if (!cur) throw new AppError("NOT_FOUND", "That invoice was not found.");
      if (cur.status !== "draft") throw new AppError("CONFLICT", "This invoice has been issued and can no longer be edited. Void it and make a new one if it is wrong.");
    } else {
      const r = await q1<{ id: string }>(
        `INSERT INTO invoices (source, status, issue_date, vat_registered, business_snapshot, created_by) VALUES ('manual','draft',$1,$2,$3,$4) RETURNING id`,
        [v.issueDate, settings.vat_registered, JSON.stringify(snapshot(settings)), actor.id], c);
      invId = r!.id;
    }
    await writeDraft(c, invId, v, settings);
    let invoiceNo: string | null = null;
    if (opts.issue) invoiceNo = await issueLocked(c, invId);
    await audit(c, actor, opts.issue ? "invoice.issue" : id ? "invoice.update_draft" : "invoice.create_draft", "invoice", invId, { invoiceNo, total: v.lines.length });
    return { id: invId, invoiceNo };
  });
}

async function issueLocked(c: Db, id: string): Promise<string> {
  const inv = await q1<{ total_cents: number; status: InvoiceStatus; lines: number }>(
    `SELECT total_cents, status, (SELECT count(*) FROM invoice_lines WHERE invoice_id = $1) AS lines FROM invoices WHERE id = $1 FOR UPDATE`, [id], c);
  if (!inv) throw new AppError("NOT_FOUND", "That invoice was not found.");
  if (inv.status !== "draft") throw new AppError("CONFLICT", "This invoice is already issued.");
  if (!inv.lines) throw new AppError("VALIDATION", "Add at least one line before issuing.");
  if (inv.total_cents <= 0) throw new AppError("VALIDATION", "The invoice total must be more than R0.00.");
  const no = await nextNumber(c, "invoice", "INV-");
  await q(`UPDATE invoices SET invoice_no=$2, status='issued', issued_at=now(), updated_at=now() WHERE id=$1`, [id, no], c);
  return no;
}

export async function issueInvoice(actor: Actor, id: string) {
  assertRole(actor, ["owner"]);
  return tx(async (c) => {
    const no = await issueLocked(c, id);
    await audit(c, actor, "invoice.issue", "invoice", id, { invoiceNo: no });
    return no;
  });
}

export async function deleteDraft(actor: Actor, id: string) {
  assertRole(actor, ["owner"]);
  await tx(async (c) => {
    const cur = await q1<{ status: InvoiceStatus }>(`SELECT status FROM invoices WHERE id = $1 FOR UPDATE`, [id], c);
    if (!cur) throw new AppError("NOT_FOUND", "That invoice was not found.");
    if (cur.status !== "draft") throw new AppError("CONFLICT", "Issued invoices are kept for your records. Void it instead.");
    await q(`DELETE FROM invoices WHERE id = $1`, [id], c);
    await audit(c, actor, "invoice.delete_draft", "invoice", id, {});
  });
}

export const markPaidInput = z.object({
  method: z.enum(["cash", "card", "eft", "other"], { error: "Choose how the customer paid" }),
  date: z.string().refine(isYmd, "Choose the payment date"),
  reference: txt(60),
});

export async function markPaid(actor: Actor, id: string, input: z.input<typeof markPaidInput>) {
  assertRole(actor, ["owner"]);
  const r = markPaidInput.safeParse(input);
  if (!r.success) throw new AppError("VALIDATION", r.error.issues[0].message);
  await tx(async (c) => {
    const cur = await q1<{ status: InvoiceStatus; issue_date: string }>(`SELECT status, issue_date FROM invoices WHERE id = $1 FOR UPDATE`, [id], c);
    if (!cur) throw new AppError("NOT_FOUND", "That invoice was not found.");
    if (cur.status !== "issued") throw new AppError("CONFLICT", cur.status === "paid" ? "This invoice is already paid." : "Only issued invoices can be marked as paid.");
    // Noon SA time on the chosen day keeps the date stable in every report.
    await q(`UPDATE invoices SET status='paid', paid_method=$2, paid_reference=$3, paid_at=($4::date + time '12:00') AT TIME ZONE 'Africa/Johannesburg', updated_at=now() WHERE id=$1`,
      [id, r.data.method, r.data.reference, r.data.date], c);
    await audit(c, actor, "invoice.paid", "invoice", id, r.data);
  });
}

export async function markUnpaid(actor: Actor, id: string) {
  assertRole(actor, ["owner"]);
  await tx(async (c) => {
    const cur = await q1<{ status: InvoiceStatus; source: string }>(`SELECT status, source FROM invoices WHERE id = $1 FOR UPDATE`, [id], c);
    if (!cur) throw new AppError("NOT_FOUND", "That invoice was not found.");
    if (cur.status !== "paid" || cur.source !== "manual") throw new AppError("CONFLICT", "Only a paid manual invoice can be set back to unpaid.");
    await q(`UPDATE invoices SET status='issued', paid_at=NULL, paid_method='', paid_reference='', updated_at=now() WHERE id=$1`, [id], c);
    await audit(c, actor, "invoice.unpaid", "invoice", id, {});
  });
}

export async function voidInvoice(actor: Actor, id: string, reason: string) {
  assertRole(actor, ["owner"]);
  const why = reason.trim().slice(0, 300);
  if (why.length < 3) throw new AppError("VALIDATION", "Say why the invoice is being voided.");
  await tx(async (c) => {
    const cur = await q1<{ status: InvoiceStatus; source: string }>(`SELECT status, source FROM invoices WHERE id = $1 FOR UPDATE`, [id], c);
    if (!cur) throw new AppError("NOT_FOUND", "That invoice was not found.");
    if (cur.status === "draft") throw new AppError("CONFLICT", "Drafts can simply be deleted.");
    if (cur.status === "void") throw new AppError("CONFLICT", "This invoice is already void.");
    if (cur.source === "sale") throw new AppError("CONFLICT", "This invoice belongs to a till sale. Process a return on the receipt instead.");
    await q(`UPDATE invoices SET status='void', void_reason=$2, voided_at=now(), updated_at=now() WHERE id=$1`, [id, why], c);
    await audit(c, actor, "invoice.void", "invoice", id, { reason: why });
  });
}

/** Copy an invoice's customer and lines into a new draft dated today. */
export async function duplicateInvoice(actor: Actor, id: string): Promise<string> {
  assertRole(actor, ["owner"]);
  const inv = await getInvoice(actor, id);
  if (!inv) throw new AppError("NOT_FOUND", "That invoice was not found.");
  const today = (await q1<{ d: string }>(`SELECT ${BUSINESS_DATE_SQL}::text AS d`))!.d;
  const settings = await getSettings();
  const due = settings.invoice_terms_days ? (await q1<{ d: string }>(`SELECT ($1::date + $2::int)::text AS d`, [today, settings.invoice_terms_days]))!.d : today;
  const r = await saveManualInvoice(actor, null, {
    billTo: { name: inv.bill_name, company: inv.bill_company, email: inv.bill_email, phone: inv.bill_phone, address: inv.bill_address, vatNumber: inv.bill_vat_number },
    issueDate: today, dueDate: due, reference: "", notes: inv.notes, paymentInfo: inv.payment_info || settings.invoice_payment_info,
    lines: inv.lines.map((l) => ({ variantId: l.variant_id, description: l.description, sku: l.sku, quantity: l.quantity, unitPriceCents: l.unit_price_cents })),
  });
  return r.id;
}

export async function recordEmail(invoiceId: string, to: string, status: InvoiceEmail["status"], error: string, actor: Actor | null) {
  await q(`INSERT INTO invoice_emails (invoice_id, to_email, status, error, sent_by) VALUES ($1,$2,$3,$4,$5)`,
    [invoiceId, to, status, error.slice(0, 300), actor?.id ?? null]);
}

export const emailInput = z.object({ to: email, message: txt(1000) });
