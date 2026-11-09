import "server-only";
import { z } from "zod";
import { verifyPassword } from "better-auth/crypto";
import { BUSINESS_DATE_SQL, q, q1, tx } from "./db";
import { AppError } from "./errors";
import { assertRole, type Actor } from "./session-types";
import { applyMovement, nextNumber } from "./stock";
import { vatIncluded } from "@/lib/money";
import { audit } from "./audit";

export const returnInput = z.object({
  idempotencyKey: z.string().uuid(),
  saleId: z.string().uuid(),
  reason: z.string().trim().min(3, "Enter the reason for the return").max(300),
  refundMethod: z.enum(["cash", "card"]),
  /** Card refunds are done on the separate terminal; staff confirm it was approved. */
  refundConfirmed: z.literal(true, { error: "Confirm the refund has been paid out (cash given or card terminal approved)" }),
  refundReference: z.string().trim().max(40).default(""),
  lines: z.array(z.object({
    saleLineId: z.coerce.number().int().positive(),
    quantity: z.coerce.number().int().min(1).max(999),
    condition: z.enum(["resellable", "damaged"]),
  })).min(1, "Choose at least one item to return"),
  /** When a cashier processes the return, an owner must authorise with their own password. */
  ownerApproval: z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(128) }).optional(),
});
export type ReturnInput = z.input<typeof returnInput>;

// Throttle owner-authorisation attempts per staff member (single app instance, in memory).
const failures = new Map<string, number[]>();
const WINDOW_MS = 15 * 60 * 1000, MAX_FAILURES = 5;

/** Verify an owner's credentials for a one-off authorisation. Returns the owner's user id. */
async function verifyOwner(actorId: string, email: string, password: string): Promise<string> {
  const now = Date.now();
  const recent = (failures.get(actorId) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_FAILURES) throw new AppError("FORBIDDEN", "Too many failed owner authorisations. Wait 15 minutes or ask the owner to sign in.");
  const row = await q1<{ id: string; password: string | null }>(
    `SELECT u.id, a.password FROM "user" u JOIN account a ON a."userId" = u.id AND a."providerId" = 'credential'
     WHERE lower(u.email) = $1 AND u.role = 'owner' AND u.active`, [email]);
  const ok = row?.password ? await verifyPassword({ hash: row.password, password }) : false;
  if (!row || !ok) {
    failures.set(actorId, [...recent, now]);
    throw new AppError("FORBIDDEN", "Owner authorisation failed. Check the owner e-mail and password.");
  }
  failures.delete(actorId);
  return row.id;
}

export type ReturnResult = { returnId: number; returnNo: string; totalCents: number; replayed: boolean };

/**
 * Record a full or partial return against the original sale lines. The original sale
 * is never modified. Quantities are capped at the unreturned amount; only resellable
 * goods go back into stock. VAT reproduces the original line's rate and rounding.
 */
export async function processReturn(actor: Actor, input: ReturnInput): Promise<ReturnResult> {
  assertRole(actor, ["owner", "cashier"]);
  const p = returnInput.safeParse(input);
  if (!p.success) throw new AppError("VALIDATION", p.error.issues[0].message);
  const data = p.data;

  let authorisedBy = actor.id;
  if (actor.role !== "owner") {
    if (!data.ownerApproval) throw new AppError("FORBIDDEN", "Returns must be authorised by the owner.");
    authorisedBy = await verifyOwner(actor.id, data.ownerApproval.email, data.ownerApproval.password);
  }

  return tx(async (c) => {
    await c.query(`SELECT pg_advisory_xact_lock(hashtext('return:' || $1))`, [data.idempotencyKey]);
    const prior = await q1<{ id: number; return_no: string; total_cents: number }>(
      `SELECT id, return_no, total_cents FROM returns WHERE idempotency_key = $1`, [data.idempotencyKey], c);
    if (prior) return { returnId: prior.id, returnNo: prior.return_no, totalCents: prior.total_cents, replayed: true };

    // Lock the sale so concurrent returns against it are serialised.
    const sale = await q1<{ id: string; receipt_no: string }>(`SELECT id, receipt_no FROM sales WHERE id = $1 FOR UPDATE`, [data.saleId], c);
    if (!sale) throw new AppError("NOT_FOUND", "Receipt not found");

    const saleLines = await q<{ id: number; variant_id: number; quantity: number; unit_price_cents: number; vat_rate_bp: number; vat_cents: number; description: string;
      returned_qty: number; returned_vat: number }>(
      `SELECT sl.id, sl.variant_id, sl.quantity, sl.unit_price_cents, sl.vat_rate_bp, sl.vat_cents, sl.description,
              coalesce(sum(rl.quantity),0) AS returned_qty, coalesce(sum(rl.vat_cents),0) AS returned_vat
       FROM sale_lines sl LEFT JOIN return_lines rl ON rl.sale_line_id = sl.id
       WHERE sl.sale_id = $1 GROUP BY sl.id`, [sale.id], c);
    const byId = new Map(saleLines.map((l) => [l.id, l]));

    const requested = new Map<number, number>();
    for (const l of data.lines) {
      const sl = byId.get(l.saleLineId);
      if (!sl) throw new AppError("VALIDATION", "A returned item is not on this receipt");
      requested.set(l.saleLineId, (requested.get(l.saleLineId) ?? 0) + l.quantity);
    }
    for (const [id, qty] of requested) {
      const sl = byId.get(id)!;
      const remaining = sl.quantity - sl.returned_qty;
      if (qty > remaining) {
        throw new AppError("RETURN_LIMIT", `Only ${remaining} × ${sl.description} can still be returned on this receipt.`, { saleLineId: id, remaining });
      }
    }

    // Amounts per return line, reproducing the original line's VAT rate and rounding.
    const progress = new Map<number, { qty: number; vat: number }>();
    const computed = data.lines.map((l) => {
      const sl = byId.get(l.saleLineId)!;
      const prev = progress.get(sl.id) ?? { qty: sl.returned_qty, vat: sl.returned_vat };
      const amount = sl.unit_price_cents * l.quantity;
      const newQty = prev.qty + l.quantity;
      // On the final unit(s) the VAT is the exact remainder so the line nets to zero.
      const vat = newQty === sl.quantity ? sl.vat_cents - prev.vat : Math.min(vatIncluded(amount, sl.vat_rate_bp), sl.vat_cents - prev.vat);
      progress.set(sl.id, { qty: newQty, vat: prev.vat + vat });
      return { ...l, variantId: sl.variant_id, amount, vat };
    });
    const total = computed.reduce((s, l) => s + l.amount, 0);
    const vat = computed.reduce((s, l) => s + l.vat, 0);

    const till = await q1<{ id: number }>(`SELECT id FROM till_sessions WHERE closed_at IS NULL FOR SHARE`, [], c);
    if (data.refundMethod === "cash" && !till) throw new AppError("TILL_CLOSED", "Open the till before paying out a cash refund.");

    const returnNo = await nextNumber(c, "return", "R");
    const r = await q1<{ id: number }>(
      `INSERT INTO returns (return_no, idempotency_key, sale_id, till_session_id, processed_by, authorised_by, reason, refund_method,
                            refund_reference, total_cents, vat_cents, business_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,${BUSINESS_DATE_SQL}) RETURNING id`,
      [returnNo, data.idempotencyKey, sale.id, till?.id ?? null, actor.id, authorisedBy, data.reason, data.refundMethod,
        data.refundReference, total, vat], c);
    for (const l of computed) {
      await q(`INSERT INTO return_lines (return_id, sale_line_id, quantity, condition, amount_cents, vat_cents) VALUES ($1,$2,$3,$4,$5,$6)`,
        [r!.id, l.saleLineId, l.quantity, l.condition, l.amount, l.vat], c);
      if (l.condition === "resellable") {
        await c.query(`SELECT 1 FROM variants WHERE id = $1 FOR UPDATE`, [l.variantId]);
        await applyMovement(c, {
          variantId: l.variantId, delta: l.quantity, reason: "return", operatorId: actor.id, sourceType: "return",
          sourceRef: returnNo, note: `Return of ${sale.receipt_no}: ${data.reason}`,
        });
      }
    }
    await q(`INSERT INTO payments (return_id, direction, method, amount_cents, reference, confirmed_by, till_session_id)
             VALUES ($1,'out',$2,$3,$4,$5,$6)`, [r!.id, data.refundMethod, total, data.refundReference, actor.id, till?.id ?? null], c);
    await audit(c, actor, "sale.return", "sale", sale.id, { returnNo, authorisedBy, lines: computed, reason: data.reason });
    return { returnId: r!.id, returnNo, totalCents: total, replayed: false };
  });
}

export async function getReturn(actor: Actor, id: number) {
  assertRole(actor, ["owner", "cashier"]);
  const r = await q1<{ id: number; return_no: string; sale_id: string; receipt_no: string; created_at: string; reason: string; refund_method: string;
    refund_reference: string; total_cents: number; vat_cents: number; processed_by_name: string; authorised_by_name: string; business_snapshot: Record<string, string> }>(
    `SELECT r.id, r.return_no, r.sale_id, s.receipt_no, r.created_at, r.reason, r.refund_method, r.refund_reference, r.total_cents, r.vat_cents,
            pu.name AS processed_by_name, au.name AS authorised_by_name, s.business_snapshot
     FROM returns r JOIN sales s ON s.id = r.sale_id JOIN "user" pu ON pu.id = r.processed_by JOIN "user" au ON au.id = r.authorised_by
     WHERE r.id = $1`, [id]);
  if (!r) return null;
  const lines = await q<{ description: string; quantity: number; condition: string; amount_cents: number; vat_cents: number }>(
    `SELECT sl.description, rl.quantity, rl.condition, rl.amount_cents, rl.vat_cents FROM return_lines rl JOIN sale_lines sl ON sl.id = rl.sale_line_id
     WHERE rl.return_id = $1 ORDER BY rl.id`, [id]);
  return { ...r, lines };
}
