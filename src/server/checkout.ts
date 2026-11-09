import "server-only";
import { z } from "zod";
import { BUSINESS_DATE_SQL, getPool, q, q1, tx, type Db } from "./db";
import { AppError } from "./errors";
import { assertRole, type Actor } from "./session-types";
import { applyMovement, nextNumber } from "./stock";
import { vatIncluded } from "@/lib/money";
import { getSettings } from "./settings";

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
const lineInput = z.object({
  variantId: z.coerce.number().int().positive(),
  quantity: z.coerce.number().int().min(1).max(999),
  /** The unit price the cashier saw/accepted. Must match the current price at commit. */
  unitPriceCents: z.coerce.number().int().positive(),
});

const paymentInput = z.discriminatedUnion("method", [
  z.object({ method: z.literal("cash"), tenderedCents: z.coerce.number().int().min(0).max(10_000_000) }),
  z.object({
    method: z.literal("card"),
    /** The cashier confirmed the separate card terminal shows APPROVED. Card details are never collected. */
    terminalApproved: z.literal(true, { error: "Confirm the card terminal shows Approved" }),
    reference: z.string().trim().max(40).regex(/^[A-Za-z0-9 \-/#]*$/, "Reference may contain letters, numbers, spaces and - / #").default(""),
  }),
]);

export const checkoutInput = z.object({
  idempotencyKey: z.string().uuid(),
  lines: z.array(lineInput).min(1, "The basket is empty").max(100),
  payment: paymentInput,
});
export type CheckoutInput = z.input<typeof checkoutInput>;
export type BasketLine = z.input<typeof lineInput>;

export type LineIssue = {
  variantId: number;
  kind: "price_changed" | "insufficient_stock" | "inactive" | "missing";
  description: string;
  expectedUnitPriceCents?: number;
  currentUnitPriceCents?: number;
  requested?: number;
  available?: number;
};

export type SaleResult = { saleId: string; receiptNo: string; totalCents: number; changeCents: number; replayed: boolean };

function mergeLines(lines: z.output<typeof lineInput>[]) {
  const byVariant = new Map<number, { variantId: number; quantity: number; unitPriceCents: number }>();
  for (const l of lines) {
    const cur = byVariant.get(l.variantId);
    if (cur) {
      if (cur.unitPriceCents !== l.unitPriceCents) throw new AppError("VALIDATION", "The same item appears with two prices; refresh the basket");
      cur.quantity += l.quantity;
    } else byVariant.set(l.variantId, { ...l });
  }
  return [...byVariant.values()];
}

type LockedVariant = {
  id: number; price_cents: number; on_hand: number; inactive: boolean; common_name: string; size_label: string; sku: string;
};

async function loadVariants(db: Db, ids: number[], lock: boolean): Promise<Map<number, LockedVariant>> {
  const rows = await q<LockedVariant>(
    `SELECT v.id, v.price_cents, v.on_hand, (v.archived_at IS NOT NULL OR p.archived_at IS NOT NULL) AS inactive,
            p.common_name, v.size_label, v.sku
     FROM variants v JOIN products p ON p.id = v.product_id
     WHERE v.id = ANY($1::int[]) ORDER BY v.id ${lock ? "FOR UPDATE OF v" : ""}`,
    [ids], db);
  return new Map(rows.map((r) => [r.id, r]));
}

function findIssues(lines: { variantId: number; quantity: number; unitPriceCents: number }[], variants: Map<number, LockedVariant>): LineIssue[] {
  const issues: LineIssue[] = [];
  for (const l of lines) {
    const v = variants.get(l.variantId);
    if (!v) { issues.push({ variantId: l.variantId, kind: "missing", description: "Unknown item" }); continue; }
    const description = `${v.common_name} — ${v.size_label}`;
    if (v.inactive) issues.push({ variantId: v.id, kind: "inactive", description });
    else if (v.price_cents !== l.unitPriceCents) {
      issues.push({ variantId: v.id, kind: "price_changed", description, expectedUnitPriceCents: l.unitPriceCents, currentUnitPriceCents: v.price_cents });
    }
    if (!v.inactive && v.on_hand < l.quantity) {
      issues.push({ variantId: v.id, kind: "insufficient_stock", description, requested: l.quantity, available: v.on_hand });
    }
  }
  return issues;
}

/**
 * Pre-payment check, called when the cashier presses "Take payment".
 * Reports price changes (which must be accepted before tender), stock shortfalls and archived items.
 */
export async function validateBasket(actor: Actor, lines: BasketLine[]) {
  assertRole(actor, ["owner", "cashier"]);
  const parsed = z.array(lineInput).min(1, "The basket is empty").safeParse(lines);
  if (!parsed.success) throw new AppError("VALIDATION", parsed.error.issues[0].message);
  const merged = mergeLines(parsed.data);
  const variants = await loadVariants(getPool(), merged.map((l) => l.variantId), false);
  const issues = findIssues(merged, variants);
  const totalCents = merged.reduce((s, l) => s + (variants.get(l.variantId)?.price_cents ?? l.unitPriceCents) * l.quantity, 0);
  return { ok: issues.length === 0, issues, totalCents };
}

/** Look up an already committed sale by its checkout reference (idempotency key). */
export async function findSaleByKey(key: string, db?: Db): Promise<SaleResult | null> {
  const s = await q1<{ id: string; receipt_no: string; total_cents: number; change_cents: number | null }>(
    `SELECT s.id, s.receipt_no, s.total_cents, p.change_cents
     FROM sales s LEFT JOIN payments p ON p.sale_id = s.id AND p.direction = 'in'
     WHERE s.idempotency_key = $1`, [key], db);
  return s ? { saleId: s.id, receiptNo: s.receipt_no, totalCents: s.total_cents, changeCents: s.change_cents ?? 0, replayed: true } : null;
}

/**
 * Commit a sale. Everything happens in ONE transaction:
 *  permission + till check → lock stock rows → revalidate active/price/stock →
 *  receipt number → sale + line price/VAT snapshots → stock movements → payment.
 * The idempotency key makes double-clicks, retries and lost responses return the original sale.
 */
export async function commitSale(actor: Actor, input: CheckoutInput): Promise<SaleResult> {
  assertRole(actor, ["owner", "cashier"]);
  const parsed = checkoutInput.safeParse(input);
  if (!parsed.success) throw new AppError("VALIDATION", parsed.error.issues[0].message);
  const data = parsed.data;

  // Fast path: retry of a sale that already committed (e.g. the response was lost).
  const prior = await findSaleByKey(data.idempotencyKey);
  if (prior) return prior;

  const lines = mergeLines(data.lines);

  return tx(async (c) => {
    // Serialise concurrent submissions of the same checkout.
    await c.query(`SELECT pg_advisory_xact_lock(hashtext('sale:' || $1))`, [data.idempotencyKey]);
    const again = await findSaleByKey(data.idempotencyKey, c);
    if (again) return again;

    // Re-check the cashier is still active (deactivation applies immediately).
    const staff = await q1<{ active: boolean }>(`SELECT active FROM "user" WHERE id = $1`, [actor.id], c);
    if (!staff?.active) throw new AppError("FORBIDDEN", "This account has been deactivated.");

    const till = await q1<{ id: number }>(`SELECT id FROM till_sessions WHERE closed_at IS NULL FOR SHARE`, [], c);
    if (!till) throw new AppError("TILL_CLOSED", "The till is not open. Open the till with a cash float first.");

    const variants = await loadVariants(c, lines.map((l) => l.variantId), true);
    const issues = findIssues(lines, variants);
    if (issues.length) {
      const first = issues[0];
      if (issues.some((i) => i.kind === "missing" || i.kind === "inactive")) {
        throw new AppError("INACTIVE_PRODUCT", `${first.description} can no longer be sold. Remove it from the basket.`, { issues });
      }
      if (issues.some((i) => i.kind === "insufficient_stock")) {
        const s = issues.find((i) => i.kind === "insufficient_stock")!;
        throw new AppError("INSUFFICIENT_STOCK",
          `Only ${s.available} × ${s.description} in stock (basket has ${s.requested}).`, { issues });
      }
      throw new AppError("PRICE_CHANGED", "A price changed. Review and accept the new price before taking payment.", { issues });
    }

    const settings = await getSettings(c);
    const rate = settings.vat_registered ? settings.vat_rate_bp : 0;
    const snapLines = lines.map((l, i) => {
      const v = variants.get(l.variantId)!;
      const lineTotal = v.price_cents * l.quantity;
      return {
        lineNo: i + 1, variantId: v.id, description: `${v.common_name} — ${v.size_label}`, sku: v.sku,
        quantity: l.quantity, unitPrice: v.price_cents, lineTotal, vatRate: rate, vat: vatIncluded(lineTotal, rate),
      };
    });
    const total = snapLines.reduce((s, l) => s + l.lineTotal, 0);
    const vat = snapLines.reduce((s, l) => s + l.vat, 0);

    let tendered: number | null = null;
    let change: number | null = null;
    if (data.payment.method === "cash") {
      if (data.payment.tenderedCents < total) {
        throw new AppError("INSUFFICIENT_CASH", "Cash tendered is less than the amount due.", { totalCents: total, tenderedCents: data.payment.tenderedCents });
      }
      tendered = data.payment.tenderedCents;
      change = tendered - total;
    }

    const receiptNo = await nextNumber(c, "sale", "S");
    const snapshot = {
      business_name: settings.business_name, legal_name: settings.legal_name, registration_no: settings.registration_no,
      vat_number: settings.vat_registered ? settings.vat_number : "", address_lines: settings.address_lines,
      phone: settings.phone, email: settings.email, receipt_footer: settings.receipt_footer, vat_rate_bp: rate,
    };
    const sale = await q1<{ id: string }>(
      `INSERT INTO sales (receipt_no, idempotency_key, till_session_id, cashier_id, business_date, total_cents, vat_cents, vat_registered, business_snapshot)
       VALUES ($1,$2,$3,$4,${BUSINESS_DATE_SQL},$5,$6,$7,$8) RETURNING id`,
      [receiptNo, data.idempotencyKey, till.id, actor.id, total, vat, settings.vat_registered, JSON.stringify(snapshot)],
      c,
    );
    for (const l of snapLines) {
      await q(
        `INSERT INTO sale_lines (sale_id, line_no, variant_id, description, sku, quantity, unit_price_cents, line_total_cents, vat_rate_bp, vat_cents)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [sale!.id, l.lineNo, l.variantId, l.description, l.sku, l.quantity, l.unitPrice, l.lineTotal, l.vatRate, l.vat], c);
      await applyMovement(c, {
        variantId: l.variantId, delta: -l.quantity, reason: "sale", operatorId: actor.id, sourceType: "sale", sourceRef: receiptNo,
      });
    }
    await q(
      `INSERT INTO payments (sale_id, direction, method, amount_cents, tendered_cents, change_cents, reference, confirmed_by, till_session_id)
       VALUES ($1,'in',$2,$3,$4,$5,$6,$7,$8)`,
      [sale!.id, data.payment.method, total, tendered, change,
        data.payment.method === "card" ? data.payment.reference : "", actor.id, till.id], c);

    return { saleId: sale!.id, receiptNo, totalCents: total, changeCents: change ?? 0, replayed: false };
  });
}

/** The terminal declined the card: keep an audit record; no sale, no stock change, basket stays. */
export async function recordDeclinedCard(actor: Actor, input: { checkoutRef: string; amountCents: number; note?: string }) {
  assertRole(actor, ["owner", "cashier"]);
  const p = z.object({ checkoutRef: z.string().uuid(), amountCents: z.number().int().positive(), note: z.string().trim().max(200).default("") })
    .safeParse(input);
  if (!p.success) throw new AppError("VALIDATION", "Invalid declined-card record");
  await q(`INSERT INTO declined_card_attempts (checkout_ref, amount_cents, note, cashier_id) VALUES ($1,$2,$3,$4)`,
    [p.data.checkoutRef, p.data.amountCents, p.data.note, actor.id]);
}
