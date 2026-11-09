import "server-only";
import { z } from "zod";
import type { PoolClient } from "pg";
import { BUSINESS_DATE_SQL, q, q1, tx, type Db } from "./db";
import { AppError } from "./errors";
import { assertRole, type Actor } from "./session-types";
import { setVariantPrice } from "./catalog";
import { audit } from "./audit";

export type MovementReason = "receive" | "sale" | "return" | "damage" | "plant_loss" | "count_correction";

export const REASON_LABEL: Record<MovementReason, string> = {
  receive: "Received",
  sale: "Sold",
  return: "Returned to stock",
  damage: "Damaged",
  plant_loss: "Plant loss",
  count_correction: "Count correction",
};

/** Apply a signed stock change to a row already locked FOR UPDATE, and record the movement. */
export async function applyMovement(
  c: Db,
  m: { variantId: number; delta: number; reason: MovementReason; operatorId: string; sourceType: "delivery" | "sale" | "return" | "adjustment" | "import"; sourceRef: string; note?: string },
): Promise<number> {
  const row = await q1<{ on_hand: number }>(
    `UPDATE variants SET on_hand = on_hand + $2, updated_at = now() WHERE id = $1 AND on_hand + $2 >= 0 RETURNING on_hand`,
    [m.variantId, m.delta],
    c,
  );
  if (!row) throw new AppError("INSUFFICIENT_STOCK", "Not enough stock for this change", { variantId: m.variantId });
  await q(
    `INSERT INTO stock_movements (variant_id, quantity, balance_after, reason, note, operator_id, source_type, source_ref)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [m.variantId, m.delta, row.on_hand, m.reason, m.note ?? "", m.operatorId, m.sourceType, m.sourceRef],
    c,
  );
  return row.on_hand;
}

async function nextNumber(c: Db, name: "sale" | "return" | "delivery" | "invoice", prefix: string): Promise<string> {
  const r = await q1<{ value: number }>(`UPDATE counters SET value = value + 1 WHERE name = $1 RETURNING value`, [name], c);
  return `${prefix}${String(r!.value).padStart(6, "0")}`;
}
export { nextNumber };

// ---------------------------------------------------------------------------
// Receiving
// ---------------------------------------------------------------------------
const deliveryInput = z.object({
  idempotencyKey: z.string().uuid("Missing delivery reference"),
  supplier: z.string().trim().max(120).default(""),
  note: z.string().trim().max(500).default(""),
  lines: z.array(z.object({
    variantId: z.coerce.number().int().positive(),
    quantity: z.coerce.number().int().min(1, "Quantity must be at least 1").max(10000, "Quantity is too large"),
    priceCents: z.coerce.number().int().positive("Enter the selling price").max(100_000_00),
  })).min(1, "Add at least one item").max(200),
});
export type DeliveryInput = z.input<typeof deliveryInput>;

export type DeliveryResult = {
  deliveryId: number; deliveryNo: string; replayed: boolean;
  lines: { variantId: number; quantity: number; priceCents: number; onHand: number; priceChanged: boolean }[];
};

/**
 * Save a delivery: one transaction records the receipt, any confirmed price
 * change and a "receive" stock movement per line. Retrying with the same
 * idempotency key returns the original delivery and never double-counts.
 */
export async function receiveDelivery(actor: Actor, input: DeliveryInput): Promise<DeliveryResult> {
  assertRole(actor, ["owner"]);
  const parsed = deliveryInput.safeParse(input);
  if (!parsed.success) throw new AppError("VALIDATION", parsed.error.issues[0].message);
  const data = parsed.data;
  const ids = data.lines.map((l) => l.variantId);
  if (new Set(ids).size !== ids.length) throw new AppError("VALIDATION", "Each item may appear only once per delivery — combine the quantities");

  return tx(async (c) => {
    await c.query(`SELECT pg_advisory_xact_lock(hashtext('delivery:' || $1))`, [data.idempotencyKey]);
    const existing = await existingDelivery(c, data.idempotencyKey);
    if (existing) return existing;

    const deliveryNo = await nextNumber(c, "delivery", "D");
    const d = await q1<{ id: number }>(
      `INSERT INTO deliveries (delivery_no, idempotency_key, supplier, note, received_by, business_date)
       VALUES ($1,$2,$3,$4,$5,${BUSINESS_DATE_SQL}) RETURNING id`,
      [deliveryNo, data.idempotencyKey, data.supplier, data.note, actor.id],
      c,
    );
    const out: DeliveryResult["lines"] = [];
    // Lock in id order to avoid deadlocks with concurrent sales.
    const locked = await q<{ id: number; archived: boolean }>(
      `SELECT v.id, (v.archived_at IS NOT NULL OR p.archived_at IS NOT NULL) AS archived
       FROM variants v JOIN products p ON p.id = v.product_id WHERE v.id = ANY($1::int[]) ORDER BY v.id FOR UPDATE OF v`,
      [ids], c);
    if (locked.length !== ids.length) throw new AppError("NOT_FOUND", "One of the items no longer exists");
    const archived = locked.find((l) => l.archived);
    if (archived) throw new AppError("INACTIVE_PRODUCT", "An archived item cannot be received. Restore it first.", { variantId: archived.id });

    for (const line of data.lines) {
      const { priceChanged } = await setVariantPrice(actor, line.variantId, line.priceCents, "receiving", c);
      await q(`INSERT INTO delivery_lines (delivery_id, variant_id, quantity, price_cents) VALUES ($1,$2,$3,$4)`,
        [d!.id, line.variantId, line.quantity, line.priceCents], c);
      const onHand = await applyMovement(c, {
        variantId: line.variantId, delta: line.quantity, reason: "receive", operatorId: actor.id,
        sourceType: "delivery", sourceRef: deliveryNo, note: data.supplier ? `From ${data.supplier}` : "",
      });
      out.push({ ...line, onHand, priceChanged });
    }
    await audit(c, actor, "delivery.receive", "delivery", d!.id, { deliveryNo, lines: data.lines });
    return { deliveryId: d!.id, deliveryNo, replayed: false, lines: out };
  });
}

async function existingDelivery(c: Db, key: string): Promise<DeliveryResult | null> {
  const d = await q1<{ id: number; delivery_no: string }>(`SELECT id, delivery_no FROM deliveries WHERE idempotency_key = $1`, [key], c);
  if (!d) return null;
  const lines = await q<{ variant_id: number; quantity: number; price_cents: number; on_hand: number }>(
    `SELECT dl.variant_id, dl.quantity, dl.price_cents, v.on_hand FROM delivery_lines dl JOIN variants v ON v.id = dl.variant_id
     WHERE dl.delivery_id = $1 ORDER BY dl.id`, [d.id], c);
  return {
    deliveryId: d.id, deliveryNo: d.delivery_no, replayed: true,
    lines: lines.map((l) => ({ variantId: l.variant_id, quantity: l.quantity, priceCents: l.price_cents, onHand: l.on_hand, priceChanged: false })),
  };
}

export async function getDelivery(id: number, db?: Db) {
  const d = await q1<{ id: number; delivery_no: string; supplier: string; note: string; received_at: string; received_by_name: string }>(
    `SELECT d.id, d.delivery_no, d.supplier, d.note, d.received_at, u.name AS received_by_name
     FROM deliveries d JOIN "user" u ON u.id = d.received_by WHERE d.id = $1`, [id], db);
  if (!d) return null;
  const lines = await q<{ variant_id: number; quantity: number; price_cents: number; common_name: string; size_label: string; sku: string }>(
    `SELECT dl.variant_id, dl.quantity, dl.price_cents, p.common_name, v.size_label, v.sku
     FROM delivery_lines dl JOIN variants v ON v.id = dl.variant_id JOIN products p ON p.id = v.product_id
     WHERE dl.delivery_id = $1 ORDER BY dl.id`, [id], db);
  return { ...d, lines };
}

export async function recentDeliveries(limit = 10, db?: Db) {
  return q<{ id: number; delivery_no: string; supplier: string; received_at: string; items: number; units: number; received_by_name: string }>(
    `SELECT d.id, d.delivery_no, d.supplier, d.received_at, count(dl.id) AS items, coalesce(sum(dl.quantity),0) AS units,
            u.name AS received_by_name
     FROM deliveries d JOIN "user" u ON u.id = d.received_by LEFT JOIN delivery_lines dl ON dl.delivery_id = d.id
     GROUP BY d.id, u.name ORDER BY d.received_at DESC LIMIT $1`, [limit], db);
}

// ---------------------------------------------------------------------------
// Adjustments (owner only, always with a reason)
// ---------------------------------------------------------------------------
const adjustInput = z.discriminatedUnion("reason", [
  z.object({
    reason: z.enum(["damage", "plant_loss"]),
    variantId: z.coerce.number().int().positive(),
    quantity: z.coerce.number().int().min(1, "Enter how many to remove").max(10000),
    note: z.string().trim().min(3, "Say what happened (at least 3 characters)").max(500),
  }),
  z.object({
    reason: z.literal("count_correction"),
    variantId: z.coerce.number().int().positive(),
    countedQuantity: z.coerce.number().int().min(0, "Count cannot be negative").max(100000),
    note: z.string().trim().min(3, "Say why the count differs (at least 3 characters)").max(500),
  }),
]);
export type AdjustInput = z.input<typeof adjustInput>;

export async function adjustStock(actor: Actor, input: AdjustInput): Promise<{ onHand: number; delta: number }> {
  assertRole(actor, ["owner"]);
  const parsed = adjustInput.safeParse(input);
  if (!parsed.success) throw new AppError("VALIDATION", parsed.error.issues[0].message);
  const data = parsed.data;
  return tx(async (c) => {
    const v = await q1<{ on_hand: number }>(`SELECT on_hand FROM variants WHERE id = $1 FOR UPDATE`, [data.variantId], c);
    if (!v) throw new AppError("NOT_FOUND", "Item not found");
    const delta = data.reason === "count_correction" ? data.countedQuantity - v.on_hand : -data.quantity;
    if (delta === 0) return { onHand: v.on_hand, delta: 0 };
    if (v.on_hand + delta < 0) {
      throw new AppError("INSUFFICIENT_STOCK", `Only ${v.on_hand} in stock — you cannot remove ${-delta}.`);
    }
    const ref = `ADJ-${Date.now().toString(36).toUpperCase()}`;
    const onHand = await applyMovement(c, {
      variantId: data.variantId, delta, reason: data.reason, operatorId: actor.id,
      sourceType: "adjustment", sourceRef: ref, note: data.note,
    });
    await audit(c, actor, "stock.adjust", "variant", data.variantId, { ...data, delta, ref });
    return { onHand, delta };
  });
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------
export async function stockList(opts: { filter?: "all" | "low"; term?: string } = {}, db?: Db) {
  const like = `%${(opts.term ?? "").trim()}%`;
  return q<{
    id: number; common_name: string; size_label: string; sku: string; barcode: string; on_hand: number;
    low_stock_threshold: number; price_cents: number; is_public: boolean; relabel_needed: boolean; category_name: string; product_id: number;
  }>(
    `SELECT v.id, p.common_name, v.size_label, v.sku, v.barcode, v.on_hand, v.low_stock_threshold, v.price_cents,
            v.is_public, v.relabel_needed, c.name AS category_name, p.id AS product_id
     FROM variants v JOIN products p ON p.id = v.product_id JOIN categories c ON c.id = p.category_id
     WHERE v.archived_at IS NULL AND p.archived_at IS NULL
       AND ($1 = 'all' OR v.on_hand <= v.low_stock_threshold)
       AND (p.common_name ILIKE $2 OR v.sku ILIKE $2)
     ORDER BY (v.on_hand <= v.low_stock_threshold) DESC, p.common_name, v.size_label`,
    [opts.filter ?? "all", like],
    db,
  );
}

export async function lowStock(db?: Db) {
  return stockList({ filter: "low" }, db);
}

export async function movementHistory(opts: { variantId?: number; limit?: number } = {}, db?: Db) {
  return q<{
    id: number; variant_id: number; common_name: string; size_label: string; sku: string; quantity: number; balance_after: number;
    reason: MovementReason; note: string; occurred_at: string; operator_name: string; source_type: string; source_ref: string;
  }>(
    `SELECT m.id, m.variant_id, p.common_name, v.size_label, v.sku, m.quantity, m.balance_after, m.reason, m.note,
            m.occurred_at, u.name AS operator_name, m.source_type, m.source_ref
     FROM stock_movements m JOIN variants v ON v.id = m.variant_id JOIN products p ON p.id = v.product_id
     JOIN "user" u ON u.id = m.operator_id
     WHERE ($1::int IS NULL OR m.variant_id = $1)
     ORDER BY m.occurred_at DESC, m.id DESC LIMIT $2`,
    [opts.variantId ?? null, Math.min(opts.limit ?? 100, 500)],
    db,
  );
}

/** Ledger check: on_hand must equal the sum of recorded movements. Used by tests and the owner dashboard. */
export async function ledgerMismatches(db?: Db) {
  return q<{ id: number; on_hand: number; ledger: number }>(
    `SELECT v.id, v.on_hand, coalesce(sum(m.quantity),0) AS ledger
     FROM variants v LEFT JOIN stock_movements m ON m.variant_id = v.id
     GROUP BY v.id HAVING v.on_hand <> coalesce(sum(m.quantity),0)`, [], db);
}

export type { PoolClient };
