import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closePool, makeCategory, makeUser, onHand, resetDatabase } from "../support/db";
import { addAlias, createProduct, createVariant, getVariant, lookupCode, setVariantArchived, updateVariant, relabelQueue, acknowledgeRelabel } from "@/server/catalog";
import { adjustStock, receiveDelivery, ledgerMismatches } from "@/server/stock";
import { commitSale, findSaleByKey, recordDeclinedCard, validateBasket } from "@/server/checkout";
import { getReceipt } from "@/server/receipts";
import { processReturn } from "@/server/returns";
import { dayReport } from "@/server/reports";
import { closeTill, openTill } from "@/server/till";
import { checkLayout, createPrintJob, listPresets, savePreset } from "@/server/labels";
import { setStaffActive } from "@/server/users";
import { updateSettings } from "@/server/settings";
import { q, q1 } from "@/server/db";
import { todayBusinessDate } from "@/lib/dates";
import type { Actor } from "@/server/session-types";
import { AppError } from "@/server/errors";

let owner: Actor, cashier: Actor, categoryId: number;

async function newVariant(stock: number, priceCents = 8990, name = "Lavender") {
  const pid = await createProduct(owner, { commonName: `${name} ${randomUUID().slice(0, 4)}`, categoryId });
  const vid = await createVariant(owner, pid, { sizeLabel: "15 cm pot", priceCents, isPublic: true });
  if (stock > 0) await receiveDelivery(owner, { idempotencyKey: randomUUID(), lines: [{ variantId: vid, quantity: stock, priceCents }] });
  return vid;
}

async function expectAppError(p: Promise<unknown>, code: AppError["code"]) {
  const err = await p.then(() => null, (e) => e);
  expect(err, `expected ${code}`).toBeInstanceOf(AppError);
  expect((err as AppError).code).toBe(code);
  return err as AppError;
}

const cash = (tenderedCents: number) => ({ method: "cash" as const, tenderedCents });

beforeAll(async () => {
  await resetDatabase();
  owner = await makeUser("owner", "boss@test.local");
  cashier = await makeUser("cashier");
  categoryId = await makeCategory();
  await updateSettings(owner, { businessName: "Test Nursery", vatRegistered: true, vatNumber: "4123456789", vatRatePercent: 15 });
  await openTill(owner, { floatCents: 0 });
});
afterAll(closePool);

describe("checkout safety", () => {
  it("duplicate checkout (double-click) creates one sale and moves stock once", async () => {
    const v = await newVariant(5);
    const input = { idempotencyKey: randomUUID(), lines: [{ variantId: v, quantity: 1, unitPriceCents: 8990 }], payment: cash(10000) };
    const [a, b, c] = await Promise.all([commitSale(cashier, input), commitSale(cashier, input), commitSale(cashier, input)]);
    expect(new Set([a.receiptNo, b.receiptNo, c.receiptNo]).size).toBe(1);
    expect([a, b, c].filter((r) => !r.replayed)).toHaveLength(1);
    expect(await onHand(v)).toBe(4);
    const n = await q1<{ n: number }>(`SELECT count(*) AS n FROM sales WHERE idempotency_key = $1`, [input.idempotencyKey]);
    expect(n!.n).toBe(1);
  });

  it("lost response after commit: retrying the same checkout reference returns the original sale", async () => {
    const v = await newVariant(3);
    const key = randomUUID();
    const input = { idempotencyKey: key, lines: [{ variantId: v, quantity: 2, unitPriceCents: 8990 }], payment: { method: "card" as const, terminalApproved: true as const, reference: "AUTH 123456" } };
    const first = await commitSale(cashier, input);
    // …the response never reached the till. Cashier uses "Finish this sale" (same key).
    expect(await findSaleByKey(key)).toMatchObject({ receiptNo: first.receiptNo, replayed: true });
    const retry = await commitSale(cashier, input);
    expect(retry).toMatchObject({ receiptNo: first.receiptNo, saleId: first.saleId, replayed: true });
    expect(await onHand(v)).toBe(1);
    const pays = await q1<{ n: number }>(`SELECT count(*) AS n FROM payments WHERE sale_id = $1`, [first.saleId]);
    expect(pays!.n).toBe(1);
  });

  it("two sessions attempting the final pot: exactly one succeeds, the other is told which line", async () => {
    const v = await newVariant(1);
    const cashier2 = await makeUser("cashier");
    const attempt = (who: Actor) => commitSale(who, { idempotencyKey: randomUUID(), lines: [{ variantId: v, quantity: 1, unitPriceCents: 8990 }], payment: cash(10000) });
    const results = await Promise.allSettled([attempt(cashier), attempt(cashier2)]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0].reason.code).toBe("INSUFFICIENT_STOCK");
    expect(failed[0].reason.details.issues[0]).toMatchObject({ variantId: v, available: 0, requested: 1 });
    expect(await onHand(v)).toBe(0);
  });

  it("rejected card payment records nothing but an audit row; basket can then be paid in cash", async () => {
    const v = await newVariant(2);
    const key = randomUUID();
    await recordDeclinedCard(cashier, { checkoutRef: key, amountCents: 8990, note: "Insufficient funds" });
    expect(await findSaleByKey(key)).toBeNull();
    expect(await onHand(v)).toBe(2);
    // Card without terminal approval is refused outright
    await expectAppError(commitSale(cashier, { idempotencyKey: key, lines: [{ variantId: v, quantity: 1, unitPriceCents: 8990 }],
      payment: { method: "card", terminalApproved: false as unknown as true } }), "VALIDATION");
    const sale = await commitSale(cashier, { idempotencyKey: key, lines: [{ variantId: v, quantity: 1, unitPriceCents: 8990 }], payment: cash(8990) });
    expect(sale.changeCents).toBe(0);
    expect(await onHand(v)).toBe(1);
  });

  it("unknown barcode resolves to nothing and changes nothing", async () => {
    expect(await lookupCode("99999999")).toBeNull();
    expect(await lookupCode("not a code!")).toBeNull();
    expect(await ledgerMismatches()).toEqual([]);
  });

  it("stale price: checkout is refused until the cashier accepts the new price", async () => {
    const v = await newVariant(4, 8990);
    const basket = [{ variantId: v, quantity: 1, unitPriceCents: 8990 }];
    const cur = (await getVariant(v))!;
    await updateVariant(owner, v, { sizeLabel: cur.size_label, sku: cur.sku, priceCents: 9990, lowStockThreshold: 3, isPublic: true });
    const check = await validateBasket(cashier, basket);
    expect(check.ok).toBe(false);
    expect(check.issues[0]).toMatchObject({ kind: "price_changed", expectedUnitPriceCents: 8990, currentUnitPriceCents: 9990 });
    const err = await expectAppError(commitSale(cashier, { idempotencyKey: randomUUID(), lines: basket, payment: cash(10000) }), "PRICE_CHANGED");
    expect((err.details as { issues: unknown[] }).issues).toHaveLength(1);
    expect(await onHand(v)).toBe(4);
    const ok = await commitSale(cashier, { idempotencyKey: randomUUID(), lines: [{ ...basket[0], unitPriceCents: 9990 }], payment: cash(10000) });
    expect(ok.totalCents).toBe(9990);
    expect(ok.changeCents).toBe(10);
    // Price change flagged the variant for new shelf labels until staff acknowledge
    expect((await relabelQueue()).map((r) => r.id)).toContain(v);
    await acknowledgeRelabel(cashier, [v]);
    expect((await relabelQueue()).map((r) => r.id)).not.toContain(v);
  });

  it("insufficient cash is refused and nothing is recorded", async () => {
    const v = await newVariant(2);
    const key = randomUUID();
    const err = await expectAppError(commitSale(cashier, { idempotencyKey: key, lines: [{ variantId: v, quantity: 2, unitPriceCents: 8990 }], payment: cash(15000) }), "INSUFFICIENT_CASH");
    expect(err.details).toMatchObject({ totalCents: 17980 });
    expect(await findSaleByKey(key)).toBeNull();
    expect(await onHand(v)).toBe(2);
    const counter = await q1<{ value: number }>(`SELECT value FROM counters WHERE name = 'sale'`);
    const sales = await q1<{ n: number }>(`SELECT count(*) AS n FROM sales`);
    expect(counter!.value).toBe(sales!.n); // receipt numbers stay gap-free
  });

  it("archived products cannot be sold", async () => {
    const v = await newVariant(2);
    await setVariantArchived(owner, v, true);
    await expectAppError(commitSale(cashier, { idempotencyKey: randomUUID(), lines: [{ variantId: v, quantity: 1, unitPriceCents: 8990 }], payment: cash(10000) }), "INACTIVE_PRODUCT");
    await setVariantArchived(owner, v, false);
  });

  it("checkout needs an open till", async () => {
    const v = await newVariant(1);
    await closeTill(owner, { countedCents: (await q1<{ e: number }>(`SELECT 0 AS e`))!.e, note: "test close" }).catch(() => undefined);
    await expectAppError(commitSale(cashier, { idempotencyKey: randomUUID(), lines: [{ variantId: v, quantity: 1, unitPriceCents: 8990 }], payment: cash(10000) }), "TILL_CLOSED");
    await openTill(owner, { floatCents: 0 });
  });

  it("sales are immutable at the database level", async () => {
    const s = await q1<{ id: string }>(`SELECT id FROM sales LIMIT 1`);
    await expect(q(`UPDATE sales SET total_cents = 1 WHERE id = $1`, [s!.id])).rejects.toThrow(/immutable/);
    await expect(q(`DELETE FROM sale_lines WHERE sale_id = $1`, [s!.id])).rejects.toThrow(/immutable/);
  });
});

describe("returns", () => {
  let saleId: string, lineId: number, v: number;
  beforeEach(async () => {
    v = await newVariant(3);
    const s = await commitSale(cashier, { idempotencyKey: randomUUID(), lines: [{ variantId: v, quantity: 2, unitPriceCents: 8990 }], payment: cash(20000) });
    saleId = s.saleId;
    lineId = (await getReceipt(owner, saleId))!.lines[0].id;
  });

  it("damaged return refunds but does not restock", async () => {
    const before = await dayReport(owner, todayBusinessDate());
    const r = await processReturn(owner, { idempotencyKey: randomUUID(), saleId, reason: "Arrived home broken", refundMethod: "cash", refundConfirmed: true,
      lines: [{ saleLineId: lineId, quantity: 1, condition: "damaged" }] });
    expect(r.totalCents).toBe(8990);
    expect(await onHand(v)).toBe(1);
    const after = await dayReport(owner, todayBusinessDate());
    expect(after.returnsCents - before.returnsCents).toBe(8990);
  });

  it("caps returns at the unreturned quantity and is idempotent", async () => {
    const key = randomUUID();
    const input = { idempotencyKey: key, saleId, reason: "Wrong colour", refundMethod: "card" as const, refundConfirmed: true as const, refundReference: "RF1",
      lines: [{ saleLineId: lineId, quantity: 2, condition: "resellable" as const }] };
    const a = await processReturn(owner, input);
    const b = await processReturn(owner, input);
    expect(b).toMatchObject({ returnNo: a.returnNo, replayed: true });
    expect(await onHand(v)).toBe(3);
    await expectAppError(processReturn(owner, { ...input, idempotencyKey: randomUUID(), lines: [{ saleLineId: lineId, quantity: 1, condition: "resellable" }] }), "RETURN_LIMIT");
    // Full return VAT exactly reverses the original line VAT
    const line = (await getReceipt(owner, saleId))!.lines[0];
    const vatBack = await q1<{ v: number }>(`SELECT sum(vat_cents) AS v FROM return_lines WHERE sale_line_id = $1`, [lineId]);
    expect(vatBack!.v).toBe(line.vat_cents);
  });

  it("cashier needs owner authorisation; a wrong password is refused", async () => {
    const base = { idempotencyKey: randomUUID(), saleId, reason: "Changed mind", refundMethod: "cash" as const, refundConfirmed: true as const,
      lines: [{ saleLineId: lineId, quantity: 1, condition: "resellable" as const }] };
    await expectAppError(processReturn(cashier, base), "FORBIDDEN");
    await expectAppError(processReturn(cashier, { ...base, ownerApproval: { email: "boss@test.local", password: "wrong password!" } }), "FORBIDDEN");
    await expectAppError(processReturn(cashier, { ...base, ownerApproval: { email: cashier.email, password: "correct horse battery" } }), "FORBIDDEN");
    const ok = await processReturn(cashier, { ...base, ownerApproval: { email: "boss@test.local", password: "correct horse battery" } });
    const row = await q1<{ authorised_by: string; processed_by: string }>(`SELECT authorised_by, processed_by FROM returns WHERE id = $1`, [ok.returnId]);
    expect(row).toEqual({ authorised_by: owner.id, processed_by: cashier.id });
  });
});

describe("permissions", () => {
  it("blocks cashier price editing, receiving, adjustments and reports", async () => {
    const v = await newVariant(1);
    const cur = (await getVariant(v))!;
    await expectAppError(updateVariant(cashier, v, { sizeLabel: cur.size_label, sku: cur.sku, priceCents: 1, lowStockThreshold: 1, isPublic: true }), "FORBIDDEN");
    await expectAppError(receiveDelivery(cashier, { idempotencyKey: randomUUID(), lines: [{ variantId: v, quantity: 1, priceCents: 1 }] }), "FORBIDDEN");
    await expectAppError(adjustStock(cashier, { reason: "damage", variantId: v, quantity: 1, note: "dropped" }), "FORBIDDEN");
    await expectAppError(dayReport(cashier, todayBusinessDate()), "FORBIDDEN");
    expect((await getVariant(v))!.price_cents).toBe(8990);
  });

  it("a deactivated cashier cannot complete a sale", async () => {
    const temp = await makeUser("cashier");
    const v = await newVariant(1);
    await setStaffActive(owner, temp.id, false);
    await expectAppError(commitSale(temp, { idempotencyKey: randomUUID(), lines: [{ variantId: v, quantity: 1, unitPriceCents: 8990 }], payment: cash(10000) }), "FORBIDDEN");
    expect(await onHand(v)).toBe(1);
  });
});

describe("stock and barcodes", () => {
  it("receiving retries are safe", async () => {
    const v = await newVariant(0);
    const input = { idempotencyKey: randomUUID(), lines: [{ variantId: v, quantity: 12, priceCents: 8990 }] };
    const [a, b] = await Promise.all([receiveDelivery(owner, input), receiveDelivery(owner, input)]);
    expect(a.deliveryNo).toBe(b.deliveryNo);
    expect(await onHand(v)).toBe(12);
  });

  it("adjustments need a reason and can never make stock negative", async () => {
    const v = await newVariant(2);
    await expectAppError(adjustStock(owner, { reason: "plant_loss", variantId: v, quantity: 1, note: "" }), "VALIDATION");
    await expectAppError(adjustStock(owner, { reason: "damage", variantId: v, quantity: 3, note: "frost" }), "INSUFFICIENT_STOCK");
    expect(await adjustStock(owner, { reason: "count_correction", variantId: v, countedQuantity: 5, note: "found behind tunnel" })).toEqual({ onHand: 5, delta: 3 });
    expect(await adjustStock(owner, { reason: "plant_loss", variantId: v, quantity: 2, note: "frost" })).toEqual({ onHand: 3, delta: -2 });
    await expect(q(`UPDATE variants SET on_hand = -1 WHERE id = $1`, [v])).rejects.toThrow(/check/);
  });

  it("supplier aliases keep leading zeros, are unique across all codes and are never reused", async () => {
    const v1 = await newVariant(1);
    const v2 = await newVariant(1);
    await addAlias(owner, v1, "0060012345678");
    expect((await lookupCode("0060012345678"))?.id).toBe(v1);
    expect(await lookupCode("60012345678")).toBeNull();
    await expectAppError(addAlias(owner, v2, "0060012345678"), "CONFLICT");
    const internal = (await getVariant(v1))!.barcode;
    await expectAppError(addAlias(owner, v2, internal), "CONFLICT");
    // Archive: the code no longer sells, but it is still registered and cannot be reused
    await setVariantArchived(owner, v1, true);
    await expectAppError(addAlias(owner, v2, internal), "CONFLICT");
    await q(`DELETE FROM barcodes WHERE code = $1`, [internal]); // rule turns deletes into no-ops
    expect(await q1(`SELECT 1 FROM barcodes WHERE code = $1`, [internal])).toBeTruthy();
    const fresh = await newVariant(0);
    expect((await getVariant(fresh))!.barcode).not.toBe(internal);
  });

  it("scans, label printing and abandoned baskets leave stock untouched", async () => {
    const v = await newVariant(7);
    const code = (await getVariant(v))!.barcode;
    await lookupCode(code); await lookupCode(code);
    await validateBasket(cashier, [{ variantId: v, quantity: 2, unitPriceCents: 8990 }]);
    await createPrintJob(cashier, { purpose: "batch", presetId: 1, items: [{ variantId: v, quantity: 5 }] });
    await createPrintJob(cashier, { purpose: "test", presetId: 2, items: [{ variantId: v, quantity: 5 }] });
    expect(await onHand(v)).toBe(7);
    expect(await ledgerMismatches()).toEqual([]);
  });
});

describe("label layouts", () => {
  it("rejects a layout too small for the code", async () => {
    const [roll] = await listPresets();
    expect(() => checkLayout({ ...roll, label_width_mm: 25 }, "21000001")).toThrow(/needs .* mm including quiet zones/);
    expect(() => checkLayout({ ...roll, label_height_mm: 15 }, "21000001")).toThrow(/too short/);
    expect(() => checkLayout({ ...roll, module_mm: 0.2 }, "21000001")).toThrow(/minimum/);
    await expectAppError(savePreset(owner, null, { name: "Tiny", kind: "roll", pageWidthMm: 25, pageHeightMm: 20, labelWidthMm: 25, labelHeightMm: 20,
      marginTopMm: 0, marginLeftMm: 0, pitchXMm: 25, pitchYMm: 20, columns: 1, rows: 1, paddingMm: 1, moduleMm: 0.3 }), "LAYOUT");
    await expectAppError(savePreset(owner, null, { name: "Off page", kind: "sheet", pageWidthMm: 210, pageHeightMm: 297, labelWidthMm: 70, labelHeightMm: 37,
      marginTopMm: 0, marginLeftMm: 10, pitchXMm: 70, pitchYMm: 37, columns: 3, rows: 8, paddingMm: 2, moduleMm: 0.33 }), "LAYOUT");
  });
});
