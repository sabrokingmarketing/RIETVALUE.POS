/** Bulk import and export through the real UI (production build, real PostgreSQL). */
import { test, expect, devices } from "@playwright/test";
import ExcelJS from "exceljs";
import { signIn, sql } from "./fixtures";

test.describe.configure({ mode: "serial" });

const HEAD = ["product_handle", "product_name", "category", "pot_size", "sku", "barcode", "price", "quantity", "status"];
async function xlsx(rows: string[][]) {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet("Products");
  ws.addRow(HEAD);
  for (const r of rows) { const row = ws.addRow(r); row.eachCell((c) => { c.numFmt = "@"; }); }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const count = async () => (await sql<{ n: number }>(`SELECT count(*)::int AS n FROM variants WHERE sku LIKE 'IMP-%'`))[0].n;

test("owner imports plants with several pot sizes through the guided workflow", async ({ page }) => {
  await signIn(page, "owner", "/admin/import-export");
  const file = await xlsx([
    ["imp-strelitzia", "Strelitzia Nicolai", "Indigenous", "20 cm pot", "IMP-STR-20", "", "229.90", "5", "active"],
    ["imp-strelitzia", "Strelitzia Nicolai", "Indigenous", "10 L bag", "IMP-STR-10L", "000777000", "399.90", "2", "active"],
    ["imp-spekboom", "Spekboom", "Succulents", "15 cm pot", "IMP-SPK-15", "", "59.90", "20", "active"],
    ["imp-spekboom", "Spekboom", "Succulents", "4 L bag", "IMP-SPK-4L", "", "119.90", "8", "active"],
    ["imp-glazed", "Glazed Pot", "Pots", "30 cm", "IMP-POT-30", "", "349.00", "6", "active"],
  ]);
  await page.getByTestId("import-file").setInputFiles({ name: "plants.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: file });
  await expect(page.getByText("Match your columns · plants.xlsx")).toBeVisible();
  await expect(page.getByLabel("SKU", { exact: false }).first()).toHaveValue("sku");
  await page.getByLabel("Add the quantity to stock (stock received)").check();
  await page.getByTestId("import-check").click();
  const summary = page.getByTestId("import-summary");
  await expect(summary).toContainText("New sizes");
  await expect(summary).toContainText("3 new plants");
  await expect(page.getByTestId("import-failed")).toHaveText("0");
  expect(await count()).toBe(0); // nothing written before confirming
  await page.getByTestId("import-confirm").click();
  await expect(page.getByText("Import complete")).toBeVisible({ timeout: 30000 });
  expect(await count()).toBe(5);
  const [str] = await sql<{ barcode: string; on_hand: number; price_cents: number; same: boolean }>(
    `SELECT v.barcode, v.on_hand, v.price_cents, (v.product_id = (SELECT product_id FROM variants WHERE sku = 'IMP-STR-20')) AS same FROM variants v WHERE sku = 'IMP-STR-10L'`);
  expect(str).toEqual({ barcode: "000777000", on_hand: 2, price_cents: 39990, same: true });
  // The results report downloads
  const rep = await page.request.get((await page.getByRole("link", { name: "Results (.csv)" }).getAttribute("href"))!);
  expect(rep.status()).toBe(200);
  expect(await rep.text()).toContain("IMP-SPK-4L");
});

test("export, then re-import the same file: everything matches, nothing is duplicated", async ({ page }) => {
  await signIn(page, "owner", "/admin/import-export");
  const exp = await page.request.get("/api/export?format=xlsx&q=IMP-&status=all");
  expect(exp.status()).toBe(200);
  expect(exp.headers()["content-disposition"]).toMatch(/products-\d{4}-\d{2}-\d{2}\.xlsx/);
  const buf = Buffer.from(await exp.body());
  await page.getByTestId("import-file").setInputFiles({ name: "export.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: buf });
  await page.getByLabel("Replace stock with the quantity (a stock count)").check();
  await page.getByTestId("import-check").click();
  await expect(page.getByTestId("import-summary")).toContainText("No change");
  await expect(page.getByTestId("import-summary").getByText("5", { exact: true }).first()).toBeVisible();
  await page.getByTestId("import-confirm").click();
  await expect(page.getByText("Import complete")).toBeVisible({ timeout: 30000 });
  expect(await count()).toBe(5);
  const [b] = await sql<{ barcode: string }>(`SELECT barcode FROM variants WHERE sku = 'IMP-STR-10L'`);
  expect(b.barcode).toBe("000777000");
});

test("partial failure: the bad row is held back, corrected and retried", async ({ page }) => {
  await signIn(page, "owner", "/admin/import-export");
  const file = await xlsx([
    ["imp-vygie", "Vygie", "Succulents", "8 cm pot", "IMP-VYG-8", "", "24.90", "10", "active"],
    ["imp-vygie", "Vygie", "Succulents", "15 cm pot", "IMP-VYG-15", "", "twenty", "4", "active"],
  ]);
  await page.getByTestId("import-file").setInputFiles({ name: "partial.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: file });
  await page.getByTestId("import-check").click();
  await expect(page.getByTestId("import-failed")).toHaveText("1");
  await expect(page.getByText(/Price “twenty” is not a valid amount/)).toBeVisible();
  await expect(page.getByTestId("import-confirm")).toBeDisabled(); // must acknowledge first
  await page.getByLabel(/Import the 1 valid rows now/).check();
  await page.getByTestId("import-confirm").click();
  await expect(page.getByText("Import finished with problems")).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: "Correct" }).click();
  await page.getByRole("dialog").getByLabel(/Selling price/).fill("44.90");
  await page.getByRole("button", { name: "Save and re-check" }).click();
  await expect(page.getByText("Import complete")).toBeVisible({ timeout: 30000 });
  const rows = await sql<{ sku: string; price_cents: number }>(`SELECT sku, price_cents FROM variants WHERE sku LIKE 'IMP-VYG-%' ORDER BY sku`);
  expect(rows).toEqual([{ sku: "IMP-VYG-15", price_cents: 4490 }, { sku: "IMP-VYG-8", price_cents: 2490 }]);
});

test("an invalid file is refused with a clear message", async ({ page }) => {
  await signIn(page, "owner", "/admin/import-export");
  await page.getByTestId("import-file").setInputFiles({ name: "notes.xlsx", mimeType: "application/octet-stream", buffer: Buffer.from("just text") });
  await expect(page.getByRole("alert").filter({ hasText: "not a valid .xlsx file" })).toBeVisible();
});

test("cashiers cannot import but can export a price list", async ({ page }) => {
  await signIn(page, "cashier");
  await page.goto("/admin/import-export");
  await expect(page).toHaveURL(/\/forbidden/);
  expect((await page.request.post("/api/import", { headers: { origin: "http://localhost:3100" }, multipart: { file: { name: "x.csv", mimeType: "text/csv", buffer: Buffer.from("sku\nA\n") } } })).status()).toBe(403);
  await page.goto("/till/export");
  const href = await page.getByTestId("export-csv").getAttribute("href");
  const res = await page.request.get(href!);
  expect((await res.text()).split(/\r?\n/)[0].replace(/^﻿/, "")).toBe("product_name,category,pot_size,sku,barcode,price,quantity");
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { defaultBrowserType, ...ipad } = devices["iPad (gen 7)"];
test.describe("tablet", () => {
  test.use(ipad);
  test("POS keeps the total and Take payment on screen", async ({ page }) => {
    await signIn(page, "cashier");
    const box = await page.getByTestId("take-payment").boundingBox();
    const vp = page.viewportSize()!;
    expect(box && box.y + box.height).toBeLessThanOrEqual(vp.height);
    await expect(page.getByTestId("amount-due")).toBeInViewport();
  });
});
