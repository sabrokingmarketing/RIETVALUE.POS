/**
 * The acceptance journey from the brief, run against a real PostgreSQL test database:
 * receive 12 lavender @ R89.90 → print 12 stickers → scan two → R200 cash → R20.20 change →
 * one R179.80 receipt → 10 in stock → reprint (still 10) → return one resellable → 11 in stock,
 * R89.90 net sales.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePool, makeCategory, makeUser, onHand, resetDatabase } from "../support/db";
import { createProduct, createVariant, getVariant, lookupCode } from "@/server/catalog";
import { receiveDelivery, ledgerMismatches, movementHistory } from "@/server/stock";
import { createPrintJob, renderJob } from "@/server/labels";
import { commitSale } from "@/server/checkout";
import { getReceipt } from "@/server/receipts";
import { processReturn } from "@/server/returns";
import { dayReport, dayCsv } from "@/server/reports";
import { openTill, closeTill } from "@/server/till";
import { updateSettings } from "@/server/settings";
import { todayBusinessDate } from "@/lib/dates";
import { formatZAR } from "@/lib/money";
import type { Actor } from "@/server/session-types";
import { decodePdfBarcodes, pdfPageSizesMm } from "../support/pdf";

let owner: Actor, cashier: Actor, variantId: number, code: string;

beforeAll(async () => {
  await resetDatabase();
  owner = await makeUser("owner");
  cashier = await makeUser("cashier");
  await updateSettings(owner, { businessName: "Test Nursery", vatRegistered: true, vatNumber: "4123456789", vatRatePercent: 15 });
});
afterAll(closePool);

describe("lavender journey", () => {
  let saleId: string;

  it("creates the plant and receives 12 at R89.90", async () => {
    const productId = await createProduct(owner, { commonName: "Lavender", botanicalName: "Lavandula angustifolia", categoryId: await makeCategory() });
    variantId = await createVariant(owner, productId, { sizeLabel: "15 cm pot", priceCents: 8990, isPublic: true });
    const v = (await getVariant(variantId))!;
    code = v.barcode;
    expect(code).toMatch(/^21\d{6}$/);
    const d = await receiveDelivery(owner, { idempotencyKey: randomUUID(), lines: [{ variantId, quantity: 12, priceCents: 8990 }] });
    expect(d.lines[0].onHand).toBe(12);
    expect(await onHand(variantId)).toBe(12);
  });

  it("prints 12 stickers without touching stock, and the barcodes decode", async () => {
    const presetId = 1; // default 50 × 30 mm roll
    const job = await createPrintJob(owner, { purpose: "delivery", presetId, items: [{ variantId, quantity: 12 }] });
    expect(job.labelCount).toBe(12);
    const { pdf } = await renderJob(owner, job.jobId);
    const sizes = await pdfPageSizesMm(pdf);
    expect(sizes).toHaveLength(12);
    for (const s of sizes) { expect(s.width).toBeCloseTo(50, 2); expect(s.height).toBeCloseTo(30, 2); }
    const decoded = await decodePdfBarcodes(pdf, { firstPage: 1, lastPage: 2 });
    expect(decoded).toEqual([code, code]);
    expect(await onHand(variantId)).toBe(12);
  });

  it("scans two, takes R200 cash, gives R20.20 change and issues one R179.80 receipt", async () => {
    await openTill(cashier, { floatCents: 50000 });
    const scanned = await lookupCode(code);
    expect(scanned?.id).toBe(variantId);
    // Two scans of identical pots → one line, quantity 2
    const sale = await commitSale(cashier, {
      idempotencyKey: randomUUID(),
      lines: [{ variantId, quantity: 2, unitPriceCents: scanned!.price_cents }],
      payment: { method: "cash", tenderedCents: 20000 },
    });
    expect(sale.totalCents).toBe(17980);
    expect(sale.changeCents).toBe(2020);
    expect(sale.receiptNo).toBe("S000001");
    expect(formatZAR(sale.totalCents)).toBe("R 179,80");
    saleId = sale.saleId;
    expect(await onHand(variantId)).toBe(10);
  });

  it("reprints the receipt and stock stays at 10", async () => {
    const r1 = await getReceipt(cashier, saleId);
    const r2 = await getReceipt(cashier, saleId);
    expect(r1).toEqual(r2);
    expect(r1!.total_cents).toBe(17980);
    expect(r1!.payment).toMatchObject({ method: "cash", tendered_cents: 20000, change_cents: 2020 });
    expect(r1!.lines).toHaveLength(1);
    expect(r1!.lines[0]).toMatchObject({ quantity: 2, unit_price_cents: 8990, line_total_cents: 17980 });
    expect(await onHand(variantId)).toBe(10);
  });

  it("returns one resellable plant for R89.90: 11 in stock and R89.90 net sales", async () => {
    const receipt = (await getReceipt(cashier, saleId))!;
    const ownerPassword = "correct horse battery";
    const ret = await processReturn(cashier, {
      idempotencyKey: randomUUID(), saleId, reason: "Customer changed their mind", refundMethod: "cash", refundConfirmed: true,
      lines: [{ saleLineId: receipt.lines[0].id, quantity: 1, condition: "resellable" }],
      ownerApproval: { email: owner.email, password: ownerPassword },
    });
    expect(ret.totalCents).toBe(8990);
    expect(await onHand(variantId)).toBe(11);
    const report = await dayReport(owner, todayBusinessDate());
    expect(report.grossCents).toBe(17980);
    expect(report.returnsCents).toBe(8990);
    expect(report.netCents).toBe(8990);
    expect(report.netCashCents).toBe(8990);
    // VAT on the return reproduces the original rounding (15% inclusive): sale VAT 23.45, return 11.73, net 11.72
    expect(report.vatCents).toBe(2345 - 1173);
    // Original sale is untouched
    const after = (await getReceipt(cashier, saleId))!;
    expect(after.total_cents).toBe(17980);
    expect(after.lines[0].returned_qty).toBe(1);
  });

  it("reconciles the till and the stock ledger", async () => {
    const closed = await closeTill(cashier, { countedCents: 50000 + 8990 });
    expect(closed.expectedCents).toBe(50000 + 17980 - 8990);
    expect(closed.varianceCents).toBe(0);
    expect(await ledgerMismatches()).toEqual([]);
    const reasons = (await movementHistory({ variantId })).map((m) => [m.reason, m.quantity, m.balance_after]);
    expect(reasons).toEqual([["return", 1, 11], ["sale", -2, 10], ["receive", 12, 12]]);
    const csv = await dayCsv(owner, todayBusinessDate());
    expect(csv).toContain("S000001");
    expect(csv).toContain("-89.90");
  });
});
