import "server-only";
import { q, q1 } from "./db";
import { assertRole, type Actor } from "./session-types";
import { todayBusinessDate } from "@/lib/dates";

/** Figures for the owner dashboard. Business dates are Africa/Johannesburg. */
export async function dashboardData(actor: Actor) {
  assertRole(actor, ["owner"]);
  const today = todayBusinessDate();
  const days = await q<{ d: string; gross: number; returns: number; sales: number; items: number }>(
    `WITH days AS (SELECT generate_series($1::date - 13, $1::date, '1 day')::date AS d)
     SELECT to_char(d, 'YYYY-MM-DD') AS d,
       coalesce((SELECT sum(total_cents) FROM sales WHERE business_date = days.d), 0)::int AS gross,
       coalesce((SELECT sum(total_cents) FROM returns WHERE business_date = days.d), 0)::int AS returns,
       (SELECT count(*) FROM sales WHERE business_date = days.d)::int AS sales,
       coalesce((SELECT sum(sl.quantity) FROM sale_lines sl JOIN sales s ON s.id = sl.sale_id WHERE s.business_date = days.d), 0)::int AS items
     FROM days ORDER BY d`, [today]);
  const series = days.map((x) => ({ date: x.d, net: x.gross - x.returns, sales: x.sales, items: x.items }));
  const t = series[series.length - 1], y = series[series.length - 2];
  const split = await q<{ method: string; amount: number }>(
    `SELECT p.method, sum(CASE WHEN p.direction = 'in' THEN p.amount_cents ELSE -p.amount_cents END)::int AS amount
     FROM payments p LEFT JOIN sales s ON s.id = p.sale_id LEFT JOIN returns r ON r.id = p.return_id
     WHERE coalesce(s.business_date, r.business_date) > $1::date - 7 GROUP BY p.method`, [today]);
  const top = await q<{ name: string; qty: number; cents: number }>(
    `SELECT sl.description AS name, sum(sl.quantity)::int AS qty, sum(sl.line_total_cents)::int AS cents
     FROM sale_lines sl JOIN sales s ON s.id = sl.sale_id WHERE s.business_date > $1::date - 7
     GROUP BY sl.description ORDER BY qty DESC, cents DESC LIMIT 5`, [today]);
  const low = await q<{ id: number; name: string; size: string; on_hand: number; threshold: number }>(
    `SELECT v.id, p.common_name AS name, v.size_label AS size, v.on_hand, v.low_stock_threshold AS threshold
     FROM variants v JOIN products p ON p.id = v.product_id
     WHERE v.archived_at IS NULL AND p.archived_at IS NULL AND v.on_hand <= v.low_stock_threshold
     ORDER BY v.on_hand, p.common_name LIMIT 6`);
  const counts = await q1<{ low: number; relabel: number; products: number; units: number }>(
    `SELECT (SELECT count(*) FROM variants v JOIN products p ON p.id = v.product_id WHERE v.archived_at IS NULL AND p.archived_at IS NULL AND v.on_hand <= v.low_stock_threshold)::int AS low,
            (SELECT count(*) FROM variants WHERE relabel_needed AND archived_at IS NULL)::int AS relabel,
            (SELECT count(*) FROM variants WHERE archived_at IS NULL)::int AS products,
            (SELECT coalesce(sum(on_hand),0) FROM variants WHERE archived_at IS NULL)::int AS units`);
  const recent = await q<{ id: string; receipt_no: string; created_at: string; total_cents: number; method: string }>(
    `SELECT s.id, s.receipt_no, s.created_at, s.total_cents, p.method FROM sales s JOIN payments p ON p.sale_id = s.id AND p.direction = 'in'
     ORDER BY s.created_at DESC LIMIT 5`);
  return { today, series, todayNet: t.net, yesterdayNet: y.net, todaySales: t.sales, todayItems: t.items, split, top, low, counts: counts!, recent };
}
