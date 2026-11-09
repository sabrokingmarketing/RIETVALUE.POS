import "server-only";
import { z } from "zod";
import { BUSINESS_DATE_SQL, q, q1, tx, type Db } from "./db";
import { AppError, isUniqueViolation } from "./errors";
import { assertRole, type Actor } from "./session-types";
import { audit } from "./audit";

export type TillSession = {
  id: number; opened_at: string; business_date: string; opening_float_cents: number; opened_by_name: string;
  closed_at: string | null; expected_cash_cents: number | null; counted_cash_cents: number | null; variance_cents: number | null;
  closed_by_name: string | null; close_note: string;
};

const SESSION_SELECT = `
  SELECT t.id, t.opened_at, t.business_date, t.opening_float_cents, o.name AS opened_by_name, t.closed_at,
         t.expected_cash_cents, t.counted_cash_cents, t.variance_cents, cb.name AS closed_by_name, t.close_note
  FROM till_sessions t JOIN "user" o ON o.id = t.opened_by LEFT JOIN "user" cb ON cb.id = t.closed_by`;

export async function currentTill(db?: Db): Promise<TillSession | null> {
  return (await q1<TillSession>(`${SESSION_SELECT} WHERE t.closed_at IS NULL`, [], db)) ?? null;
}

export async function tillSessionsForDate(date: string, db?: Db) {
  return q<TillSession>(`${SESSION_SELECT} WHERE t.business_date = $1 ORDER BY t.opened_at`, [date], db);
}

/** Cash movements for a till session: float + cash taken − cash refunded. */
export async function cashSummary(tillId: number, db?: Db) {
  const r = await q1<{ float: number; cash_in: number; cash_out: number; card_in: number; card_out: number; sales: number; returns: number }>(
    `SELECT t.opening_float_cents AS float,
       coalesce((SELECT sum(amount_cents) FROM payments WHERE till_session_id = t.id AND method='cash' AND direction='in'),0) AS cash_in,
       coalesce((SELECT sum(amount_cents) FROM payments WHERE till_session_id = t.id AND method='cash' AND direction='out'),0) AS cash_out,
       coalesce((SELECT sum(amount_cents) FROM payments WHERE till_session_id = t.id AND method='card' AND direction='in'),0) AS card_in,
       coalesce((SELECT sum(amount_cents) FROM payments WHERE till_session_id = t.id AND method='card' AND direction='out'),0) AS card_out,
       (SELECT count(*) FROM sales WHERE till_session_id = t.id) AS sales,
       (SELECT count(*) FROM returns WHERE till_session_id = t.id) AS returns
     FROM till_sessions t WHERE t.id = $1`, [tillId], db);
  if (!r) throw new AppError("NOT_FOUND", "Till session not found");
  return { ...r, expected: r.float + r.cash_in - r.cash_out };
}

export async function openTill(actor: Actor, input: { floatCents: number }) {
  assertRole(actor, ["owner", "cashier"]);
  const p = z.object({ floatCents: z.number().int().min(0).max(5_000_000) }).safeParse(input);
  if (!p.success) throw new AppError("VALIDATION", "Enter the opening float in rand");
  try {
    const row = await q1<{ id: number }>(
      `INSERT INTO till_sessions (opened_by, business_date, opening_float_cents) VALUES ($1, ${BUSINESS_DATE_SQL}, $2) RETURNING id`,
      [actor.id, p.data.floatCents]);
    await audit(undefined, actor, "till.open", "till_session", row!.id, p.data);
    return row!.id;
  } catch (e) {
    if (isUniqueViolation(e)) throw new AppError("CONFLICT", "The till is already open.");
    throw e;
  }
}

export async function closeTill(actor: Actor, input: { countedCents: number; note?: string }) {
  assertRole(actor, ["owner", "cashier"]);
  const p = z.object({ countedCents: z.number().int().min(0).max(100_000_000), note: z.string().trim().max(500).default("") }).safeParse(input);
  if (!p.success) throw new AppError("VALIDATION", "Enter the counted cash in rand");
  return tx(async (c) => {
    const t = await q1<{ id: number }>(`SELECT id FROM till_sessions WHERE closed_at IS NULL FOR UPDATE`, [], c);
    if (!t) throw new AppError("TILL_CLOSED", "The till is not open.");
    const s = await cashSummary(t.id, c);
    const variance = p.data.countedCents - s.expected;
    if (variance !== 0 && p.data.note.length < 3) {
      throw new AppError("VALIDATION", "The count does not match. Add a short note explaining the difference.", { expected: s.expected, variance });
    }
    await q(`UPDATE till_sessions SET closed_by=$2, closed_at=now(), expected_cash_cents=$3, counted_cash_cents=$4, variance_cents=$5, close_note=$6
             WHERE id=$1`, [t.id, actor.id, s.expected, p.data.countedCents, variance, p.data.note], c);
    await audit(c, actor, "till.close", "till_session", t.id, { ...p.data, expected: s.expected, variance });
    return { tillId: t.id, expectedCents: s.expected, countedCents: p.data.countedCents, varianceCents: variance };
  });
}
