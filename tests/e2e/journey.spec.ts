/**
 * Browser acceptance journey (real build, real PostgreSQL):
 * create Lavender → receive 12 @ R89.90 → print 12 stickers (PDF size + decode) → open till →
 * scan two → R200 cash → R20.20 change → R179.80 receipt → 10 in stock → reprint (still 10) →
 * return one resellable → 11 in stock, R89.90 net sales → close till balanced.
 */
import { test, expect } from "@playwright/test";
import { signIn, onHandBySku, scan, expectAmountDue, sql } from "./fixtures";
import { decodePdfBarcodes, pdfPageSizesMm } from "../support/pdf";

test.describe.configure({ mode: "serial" });

let code = "";
const SKU = "LAV-15";

test("owner creates lavender, receives 12 and prints 12 labels", async ({ page }) => {
  await signIn(page, "owner", "/admin");
  await page.goto("/admin/products/new");
  await page.getByLabel("Common name").fill("Lavender");
  await page.getByLabel("Botanical name (optional)").fill("Lavandula angustifolia");
  await page.getByLabel("Category").selectOption({ label: "Herbs & lavender" });
  await page.getByLabel("Pot or pack size").fill("15 cm pot");
  await page.getByLabel("Selling price (R, incl. VAT)").fill("89.90");
  await page.getByLabel("SKU").fill(SKU);
  await page.getByRole("button", { name: "Save product" }).click();
  await expect(page.getByText("Product created")).toBeVisible();
  code = (await sql<{ barcode: string }>(`SELECT barcode FROM variants WHERE sku = $1`, [SKU]))[0].barcode;
  expect(code).toMatch(/^21\d{6}$/);
  expect(await onHandBySku(SKU)).toBe(0);

  await page.goto("/admin/receive");
  await page.getByLabel("Find the plant").fill("Lavender");
  await page.getByRole("button", { name: "Add to delivery" }).first().click();
  await page.getByLabel("Quantity").fill("12");
  await expect(page.getByLabel("Selling price (R)")).toHaveValue("89.90");
  await page.getByTestId("save-delivery").click();
  await expect(page.getByTestId("delivery-saved")).toContainText("now 12 in stock");
  expect(await onHandBySku(SKU)).toBe(12);

  await page.getByTestId("print-delivery-labels").click();
  await page.waitForURL(/\/admin\/labels\?job=\d+/);
  await expect(page.getByTestId("label-preview")).toBeVisible();
  const href = await page.getByTestId("open-pdf").getAttribute("href");
  const res = await page.request.get(href!);
  expect(res.headers()["content-type"]).toBe("application/pdf");
  const pdf = new Uint8Array(await res.body());
  const pages = await pdfPageSizesMm(pdf);
  expect(pages).toHaveLength(12);
  expect(pages[0].width).toBeCloseTo(50, 1);
  expect(pages[0].height).toBeCloseTo(30, 1);
  expect(await decodePdfBarcodes(pdf, { firstPage: 1, lastPage: 1 })).toEqual([code]);
  expect(await onHandBySku(SKU)).toBe(12); // printing never moves stock
});

test("cashier scans two, takes R200 cash and gives R20.20 change", async ({ page }) => {
  await signIn(page, "cashier", "/till/cash");
  await page.getByLabel("Opening float (R)").fill("500");
  await page.getByRole("button", { name: "Open the till" }).click();
  await page.waitForURL(/\/till$/);
  await expect(page.getByText("Till open", { exact: true })).toBeVisible();
  await expect(page.getByTestId("scan-input")).toBeFocused();
  await scan(page, code);
  await expect(page.getByTestId("last-scan")).toContainText("Lavender — 15 cm pot");
  await scan(page, code);
  await expect(page.getByTestId("basket-line")).toHaveCount(1);
  await expect(page.getByTestId("line-qty")).toHaveValue("2");
  await expect(page.getByTestId("last-scan")).toContainText("2");
  await expectAmountDue(page, "R179.80");
  await expect(page.getByTestId("scan-input")).toBeFocused();
  expect(await onHandBySku(SKU)).toBe(12); // scanning does not move stock

  await page.getByTestId("take-payment").click();
  await page.getByTestId("tendered").fill("200");
  await expect(page.getByTestId("change-preview")).toHaveText("R20.20");
  await page.getByTestId("complete-cash").click();
  await expect(page.getByTestId("sale-done")).toBeVisible();
  await expect(page.getByTestId("change-due")).toHaveText("R20.20");
  const receiptNo = await page.getByTestId("receipt-no").innerText();
  expect(receiptNo).toBe("S000001");
  const sales = await sql<{ n: number; total: number }>(`SELECT count(*)::int AS n, sum(total_cents)::int AS total FROM sales`);
  expect(sales[0]).toEqual({ n: 1, total: 17980 });
  expect(await onHandBySku(SKU)).toBe(10);
});

test("receipt reprints without touching stock; owner returns one resellable plant", async ({ page, context }) => {
  await signIn(page, "owner", "/till/receipts");
  await page.getByRole("link", { name: "S000001" }).click();
  await expect(page.getByTestId("receipt-total")).toHaveText("R179.80");
  await expect(page.getByTestId("receipt-change")).toHaveText("R20.20");

  const [printTab] = await Promise.all([context.waitForEvent("page"), page.getByTestId("reprint-80").click()]);
  await printTab.waitForLoadState();
  await expect(printTab.getByTestId("receipt")).toContainText("TAX INVOICE — COPY");
  await expect(printTab.getByTestId("receipt-total")).toHaveText("R179.80");
  await printTab.close();
  expect(await onHandBySku(SKU)).toBe(10);
  expect((await sql<{ n: number }>(`SELECT count(*)::int AS n FROM sales`))[0].n).toBe(1);

  await page.getByLabel(/Quantity back/).fill("1");
  await page.getByLabel("Reason").fill("Customer bought one too many");
  await page.getByLabel("Refund method").selectOption("cash");
  await page.getByRole("checkbox", { name: /given the customer R89.90/ }).check();
  await page.getByRole("button", { name: "Record return" }).click();
  await expect(page.getByText(/Return R000001 recorded/)).toBeVisible();
  expect(await onHandBySku(SKU)).toBe(11);

  await page.goto("/admin/reports");
  await expect(page.getByTestId("tile-gross-sales")).toHaveText("R179.80");
  await expect(page.getByTestId("tile-returns")).toHaveText("R89.90");
  await expect(page.getByTestId("tile-net-sales")).toHaveText("R89.90");

  await page.goto("/till/cash");
  await page.getByLabel("Counted cash in drawer (R)").fill("589.90");
  await page.getByRole("button", { name: "Close the till" }).click();
  await expect(page.getByTestId("till-closed")).toContainText("The till balances");
  await expect(page.getByTestId("variance")).toHaveText("R0.00");
});
