import "server-only";
import { q, q1 } from "./db";
import { assertRole, type Actor } from "./session-types";
import { lowStock } from "./stock";
import { tillSessionsForDate, cashSummary } from "./till";

export async function dayReport(actor: Actor, date: string) {
  assertRole(actor, ["owner"]);
  const totals = await q1<{ gross: number; sales_count: number; sales_vat: number; returns: number; returns_count: number; returns_vat: number }>(
    `SELECT coalesce((SELECT sum(total_cents) FROM sales WHERE business_date = $1),0) AS gross,
            (SELECT count(*) FROM sales WHERE business_date = $1) AS sales_count,
            coalesce((SELECT sum(vat_cents) FROM sales WHERE business_date = $1),0) AS sales_vat,
            coalesce((SELECT sum(total_cents) FROM returns WHERE business_date = $1),0) AS returns,
            (SELECT count(*) FROM returns WHERE business_date = $1) AS returns_count,
            coalesce((SELECT sum(vat_cents) FROM returns WHERE business_date = $1),0) AS returns_vat`, [date]);
  const split = await q<{ method: "cash" | "card"; direction: "in" | "out"; amount: number }>(
    `SELECT p.method, p.direction, sum(p.amount_cents) AS amount
     FROM payments p LEFT JOIN sales s ON s.id = p.sale_id LEFT JOIN returns r ON r.id = p.return_id
     WHERE coalesce(s.business_date, r.business_date) = $1 GROUP BY p.method, p.direction`, [date]);
  const get = (m: string, d: string) => split.find((s) => s.method === m && s.direction === d)?.amount ?? 0;
  const topPlants = await q<{ variant_id: number; description: string; sold: number; returned: number; net_qty: number; net_cents: number }>(
    `WITH sold AS (
       SELECT sl.variant_id, sum(sl.quantity) AS qty, sum(sl.line_total_cents) AS cents
       FROM sale_lines sl JOIN sales s ON s.id = sl.sale_id WHERE s.business_date = $1 GROUP BY sl.variant_id),
     ret AS (
       SELECT sl.variant_id, sum(rl.quantity) AS qty, sum(rl.amount_cents) AS cents
       FROM return_lines rl JOIN returns r ON r.id = rl.return_id JOIN sale_lines sl ON sl.id = rl.sale_line_id
       WHERE r.business_date = $1 GROUP BY sl.variant_id)
     SELECT v.id AS variant_id, p.common_name || ' — ' || v.size_label AS description,
            coalesce(sold.qty,0) AS sold, coalesce(ret.qty,0) AS returned,
            coalesce(sold.qty,0) - coalesce(ret.qty,0) AS net_qty, coalesce(sold.cents,0) - coalesce(ret.cents,0) AS net_cents
     FROM variants v JOIN products p ON p.id = v.product_id JOIN categories c ON c.id = p.category_id
     LEFT JOIN sold ON sold.variant_id = v.id LEFT JOIN ret ON ret.variant_id = v.id
     WHERE (sold.qty IS NOT NULL OR ret.qty IS NOT NULL) AND c.kind = 'plant'
     ORDER BY net_qty DESC, net_cents DESC LIMIT 10`, [date]);
  const tills = await tillSessionsForDate(date);
  const tillDetail = await Promise.all(tills.map(async (t) => ({ ...t, summary: await cashSummary(t.id) })));
  const low = await lowStock();
  const t = totals!;
  return {
    date,
    grossCents: t.gross, salesCount: t.sales_count, returnsCents: t.returns, returnsCount: t.returns_count,
    netCents: t.gross - t.returns, vatCents: t.sales_vat - t.returns_vat,
    cashInCents: get("cash", "in"), cardInCents: get("card", "in"), cashRefundCents: get("cash", "out"), cardRefundCents: get("card", "out"),
    netCashCents: get("cash", "in") - get("cash", "out"), netCardCents: get("card", "in") - get("card", "out"),
    topPlants, tills: tillDetail, lowStock: low,
  };
}

function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  // Neutralise spreadsheet formula injection.
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const rand = (c: number) => (c / 100).toFixed(2);

/** One row per sale line and per return line for the business date. */
export async function dayCsv(actor: Actor, date: string): Promise<string> {
  assertRole(actor, ["owner"]);
  const rows = await q<Record<string, string | number>>(
    `SELECT 'sale' AS type, s.receipt_no AS document, NULL AS original_receipt, to_char(s.created_at AT TIME ZONE 'Africa/Johannesburg', 'YYYY-MM-DD HH24:MI:SS') AS local_time,
            u.name AS staff, sl.sku, sl.description, sl.quantity, sl.unit_price_cents, sl.line_total_cents, sl.vat_cents, sl.vat_rate_bp,
            p.method, '' AS condition, '' AS reason
     FROM sale_lines sl JOIN sales s ON s.id = sl.sale_id JOIN "user" u ON u.id = s.cashier_id
     JOIN payments p ON p.sale_id = s.id AND p.direction='in' WHERE s.business_date = $1
     UNION ALL
     SELECT 'return', r.return_no, s.receipt_no, to_char(r.created_at AT TIME ZONE 'Africa/Johannesburg', 'YYYY-MM-DD HH24:MI:SS'),
            u.name, sl.sku, sl.description, -rl.quantity, sl.unit_price_cents, -rl.amount_cents, -rl.vat_cents, sl.vat_rate_bp,
            r.refund_method, rl.condition, r.reason
     FROM return_lines rl JOIN returns r ON r.id = rl.return_id JOIN sale_lines sl ON sl.id = rl.sale_line_id
     JOIN sales s ON s.id = r.sale_id JOIN "user" u ON u.id = r.processed_by WHERE r.business_date = $1
     ORDER BY local_time, document`, [date]);
  const header = ["type", "document", "original_receipt", "local_time", "staff", "sku", "description", "quantity",
    "unit_price_zar", "line_total_zar", "vat_zar", "vat_rate_percent", "payment_method", "condition", "reason"];
  const lines = rows.map((r) => [
    r.type, r.document, r.original_receipt, r.local_time, r.staff, r.sku, r.description, r.quantity,
    rand(Number(r.unit_price_cents)), rand(Number(r.line_total_cents)), rand(Number(r.vat_cents)), (Number(r.vat_rate_bp) / 100).toFixed(2),
    r.method, r.condition, r.reason,
  ].map(csvCell).join(","));
  return "﻿" + [header.join(","), ...lines].join("\r\n") + "\r\n";
}
