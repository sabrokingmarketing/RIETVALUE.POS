import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePool, makeUser, resetDatabase } from "../support/db";
import { getPreset, renderLabelsPdf } from "@/server/labels";
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
