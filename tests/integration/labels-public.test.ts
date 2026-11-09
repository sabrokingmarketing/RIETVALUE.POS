import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePool, makeCategory, makeUser, resetDatabase } from "../support/db";
import { createProduct, createVariant, getVariant } from "@/server/catalog";
import { receiveDelivery } from "@/server/stock";
import { getPreset, renderLabelsPdf } from "@/server/labels";
import { publicCatalogue, publicPlant } from "@/server/public";
import { q } from "@/server/db";
import { decodePdfBarcodes, pdfPageSizesMm } from "../support/pdf";
import { formatZAR, parseRandToCents, vatIncluded } from "@/lib/money";
import type { Actor } from "@/server/session-types";

let owner: Actor;
beforeAll(async () => { await resetDatabase(); owner = await makeUser("owner"); });
afterAll(closePool);

describe("label PDF", () => {
  it("A4 sheet: exact page size, start position, long names, and every barcode decodes", async () => {
    const sheet = (await getPreset(2))!;
    const labels = [
      { name: "Lavender", size: "15 cm pot", priceCents: 8990, code: "21000001" },
      { name: "Pelargonium sidoides ‘Silver Leaf’ with an extraordinarily long cultivar name that must wrap", size: "20 cm pot", priceCents: 12500, code: "21000002" },
      { name: "Supplier code with zeros", size: "6-pack", priceCents: 100, code: "00012345" },
    ];
    const pdf = await renderLabelsPdf(sheet, labels, { startPosition: 23 }); // 2 slots left on page 1 → spills to page 2
    const sizes = await pdfPageSizesMm(pdf);
    expect(sizes).toHaveLength(2);
    expect(sizes[0].width).toBeCloseTo(210, 1);
    expect(sizes[0].height).toBeCloseTo(297, 1);
    expect(await decodePdfBarcodes(pdf)).toEqual(["21000001", "21000002", "00012345"]);
  });

  it("50 × 30 mm roll bars are pure black vector rectangles at the configured module width", async () => {
    const roll = (await getPreset(1))!;
    const pdf = await renderLabelsPdf(roll, [{ name: "Lavender", size: "15 cm pot", priceCents: 8990, code: "21000001" }]);
    const content = Buffer.from(pdf).toString("latin1");
    expect(content).not.toMatch(/\/Subtype\s*\/Image/); // no raster images — vector only
    const sizes = await pdfPageSizesMm(pdf);
    expect(sizes[0]).toEqual({ width: expect.closeTo(50, 2), height: expect.closeTo(30, 2) });
  });
});

describe("money", () => {
  it("parses and formats ZAR without floating-point drift", () => {
    expect(parseRandToCents("89.90")).toBe(8990);
    expect(parseRandToCents("R 1 200,5")).toBe(120050);
    expect(parseRandToCents("0.1")).toBe(10);
    expect(parseRandToCents("abc")).toBeNull();
    expect(parseRandToCents("1.234")).toBeNull();
    expect(formatZAR(2020)).toBe("R 20,20");
    expect(vatIncluded(17980, 1500)).toBe(2345);
    expect(vatIncluded(8990, 0)).toBe(0);
  });
});

describe("public catalogue", () => {
  it("only shows published active variants and never exposes stock counts", async () => {
    const cat = await makeCategory();
    const pid = await createProduct(owner, { commonName: "Public Plant", categoryId: cat });
    const pub = await createVariant(owner, pid, { sizeLabel: "15 cm pot", priceCents: 5000, isPublic: true, lowStockThreshold: 3 });
    await createVariant(owner, pid, { sizeLabel: "Staff only", priceCents: 1000, isPublic: false });
    await receiveDelivery(owner, { idempotencyKey: randomUUID(), lines: [{ variantId: pub, quantity: 2, priceCents: 5000 }] });
    const plant = await publicPlant("public-plant");
    expect(plant?.variants).toHaveLength(1);
    expect(plant?.variants[0]).toEqual({ variant_id: pub, size_label: "15 cm pot", price_cents: 5000, availability: "limited" });
    const json = JSON.stringify(await publicCatalogue());
    expect(json).not.toMatch(/on_hand|sku|barcode|cost|cashier|email/);
    const cols = await q<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_name = 'public_catalogue'`);
    expect(cols.map((c) => c.column_name).sort()).toEqual([
      "availability", "botanical_name", "care_notes", "category_name", "category_slug", "category_sort", "common_name", "description",
      "photo_is_fixture", "photo_path", "price_cents", "product_id", "size_label", "slug", "variant_id",
    ]);
    expect((await getVariant(pub))!.on_hand).toBe(2);
  });
});
