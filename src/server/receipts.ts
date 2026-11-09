import "server-only";
import { q, q1, type Db } from "./db";
import { assertRole, type Actor } from "./session-types";

export type ReceiptLine = {
  id: number; line_no: number; variant_id: number; description: string; sku: string; quantity: number;
  unit_price_cents: number; line_total_cents: number; vat_rate_bp: number; vat_cents: number; returned_qty: number;
};

export type Receipt = {
  id: string; receipt_no: string; idempotency_key: string; created_at: string; business_date: string; cashier_name: string;
  total_cents: number; vat_cents: number; vat_registered: boolean;
  business_snapshot: {
    business_name: string; legal_name: string; registration_no: string; vat_number: string; address_lines: string;
    phone: string; email: string; receipt_footer: string; vat_rate_bp: number;
  };
  payment: { method: "cash" | "card"; amount_cents: number; tendered_cents: number | null; change_cents: number | null; reference: string };
  lines: ReceiptLine[];
  returns: { id: number; return_no: string; created_at: string; total_cents: number; refund_method: string; reason: string }[];
};

export async function getReceipt(actor: Actor, saleId: string, db?: Db): Promise<Receipt | null> {
  assertRole(actor, ["owner", "cashier"]);
  if (!/^[0-9a-f-]{36}$/i.test(saleId)) return null;
  const s = await q1<Omit<Receipt, "lines" | "payment" | "returns">>(
    `SELECT s.id, s.receipt_no, s.idempotency_key, s.created_at, s.business_date, u.name AS cashier_name, s.total_cents,
            s.vat_cents, s.vat_registered, s.business_snapshot
     FROM sales s JOIN "user" u ON u.id = s.cashier_id WHERE s.id = $1`, [saleId], db);
  if (!s) return null;
  const payment = await q1<Receipt["payment"]>(
    `SELECT method, amount_cents, tendered_cents, change_cents, reference FROM payments WHERE sale_id = $1 AND direction = 'in'`, [saleId], db);
  const lines = await q<ReceiptLine>(
    `SELECT sl.id, sl.line_no, sl.variant_id, sl.description, sl.sku, sl.quantity, sl.unit_price_cents, sl.line_total_cents,
            sl.vat_rate_bp, sl.vat_cents, coalesce((SELECT sum(rl.quantity) FROM return_lines rl WHERE rl.sale_line_id = sl.id),0) AS returned_qty
     FROM sale_lines sl WHERE sl.sale_id = $1 ORDER BY sl.line_no`, [saleId], db);
  const returns = await q<Receipt["returns"][number]>(
    `SELECT id, return_no, created_at, total_cents, refund_method, reason FROM returns WHERE sale_id = $1 ORDER BY created_at`, [saleId], db);
  return { ...s, payment: payment!, lines, returns };
}

/** Receipt lookup by receipt number, checkout reference, date or amount. */
export async function findReceipts(actor: Actor, opts: { term?: string; date?: string; limit?: number }, db?: Db) {
  assertRole(actor, ["owner", "cashier"]);
  const term = (opts.term ?? "").trim();
  const asCents = /^\d+([.,]\d{1,2})?$/.test(term) ? Math.round(Number(term.replace(",", ".")) * 100) : null;
  return q<{ id: string; receipt_no: string; created_at: string; total_cents: number; method: string; items: number; cashier_name: string; has_returns: boolean }>(
    `SELECT s.id, s.receipt_no, s.created_at, s.total_cents, p.method, (SELECT sum(quantity) FROM sale_lines WHERE sale_id = s.id) AS items,
            u.name AS cashier_name, EXISTS (SELECT 1 FROM returns r WHERE r.sale_id = s.id) AS has_returns
     FROM sales s JOIN payments p ON p.sale_id = s.id AND p.direction = 'in' JOIN "user" u ON u.id = s.cashier_id
     WHERE ($1 = '' OR upper(s.receipt_no) = upper($1) OR upper(s.receipt_no) = 'S' || lpad($1, 6, '0')
            OR s.idempotency_key::text ILIKE $1 || '%' OR p.reference ILIKE $1 OR s.total_cents = $3)
       AND ($2::date IS NULL OR s.business_date = $2::date)
     ORDER BY s.created_at DESC LIMIT $4`,
    [term, opts.date || null, asCents, Math.min(opts.limit ?? 50, 200)],
    db,
  );
}
