/** Invoices in a real browser: e-mailed from the POS after a sale, and made by hand by the owner. */
import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { signIn, scan, sql } from "./fixtures";

test.describe.configure({ mode: "serial" });
const MAIL = path.resolve("test-results/mail");
const mails = () => (fs.existsSync(MAIL) ? fs.readdirSync(MAIL).sort().map((f) => JSON.parse(fs.readFileSync(path.join(MAIL, f), "utf8"))) : []);
const SKU = "INV-ROSE";
let code = "";

test.beforeAll(async () => {
  fs.rmSync(MAIL, { recursive: true, force: true });
  const [cat] = await sql<{ id: number }>(`SELECT id FROM categories WHERE slug = 'herbs-lavender'`);
  const [p] = await sql<{ id: number }>(`INSERT INTO products (common_name, category_id, slug) VALUES ('Iceberg Rose', $1, 'iceberg-rose-inv') RETURNING id`, [cat.id]);
  const [n] = await sql<{ n: number }>(`SELECT nextval('internal_barcode_seq')::int AS n`);
  code = `21${String(n.n).padStart(6, "0")}`;
  const [v] = await sql<{ id: number }>(`INSERT INTO variants (product_id, size_label, sku, barcode, price_cents, is_public) VALUES ($1,'4 L bag',$2,$3,15900,true) RETURNING id`, [p.id, SKU, code]);
  await sql(`INSERT INTO barcodes (code, variant_id, kind) VALUES ($1,$2,'internal')`, [code, v.id]);
  const [owner] = await sql<{ id: string }>(`SELECT id FROM "user" WHERE role='owner' LIMIT 1`);
  await sql(`UPDATE variants SET on_hand = 6 WHERE id = $1`, [v.id]);
  await sql(`INSERT INTO stock_movements (variant_id, quantity, balance_after, reason, operator_id, source_type, source_ref) VALUES ($1,6,6,'receive',$2,'delivery','E2E-INV')`, [v.id, owner.id]);
  if (!(await sql(`SELECT 1 FROM till_sessions WHERE closed_at IS NULL`)).length) {
    await sql(`INSERT INTO till_sessions (opened_by, business_date, opening_float_cents) VALUES ($1, (now() AT TIME ZONE 'Africa/Johannesburg')::date, 0)`, [owner.id]);
  }
});

test("POS: the cashier ticks 'E-mail an invoice', completes a card sale, and the customer gets the PDF", async ({ page }) => {
  await signIn(page, "cashier", "/till");
  await page.evaluate(() => { localStorage.removeItem("till.basket.v1"); localStorage.removeItem("till.pending.v1"); });
  await page.reload();
  await scan(page, code);
  await expect(page.getByTestId("amount-due")).toHaveText("R159.00");
  await page.getByTestId("take-payment").click();
  await page.getByRole("radio", { name: "Card" }).click();
  await page.getByText("E-mail an invoice").click();
  await page.getByTestId("invoice-email").fill("not-an-address");
  await page.getByTestId("card-approved").click();
  await expect(page.getByText(/Check the customer's e-mail address/)).toBeVisible();
  await page.getByTestId("invoice-email").fill("thandi@example.com");
  await page.getByTestId("invoice-name").fill("Thandi Mokoena");
  await page.getByTestId("card-approved").click();
  await expect(page.getByTestId("sale-done")).toBeVisible();
  await expect(page.getByTestId("sale-invoice-status")).toContainText(/Invoice INV-\d{6} e-mailed to thandi@example.com/);
  const m = mails().at(-1);
  expect(m.to).toBe("thandi@example.com");
  expect(m.subject).toMatch(/^Tax invoice INV-\d{6} from E2E Test Nursery$/);
  expect(m.attachments[0].contentType).toBe("application/pdf");
  const [inv] = await sql<{ status: string; total_cents: number; bill_name: string }>(`SELECT status, total_cents, bill_name FROM invoices WHERE bill_email = 'thandi@example.com'`);
  expect(inv).toEqual({ status: "paid", total_cents: 15900, bill_name: "Thandi Mokoena" });

  // Send it to another address from the same screen: still one invoice.
  await page.getByRole("button", { name: /Send to another address/ }).click();
  await page.getByRole("dialog").getByTestId("invoice-email").fill("thandi.work@example.com");
  await page.getByTestId("sale-invoice-send").click();
  await expect(page.getByTestId("sale-invoice-status")).toContainText("thandi.work@example.com");
  expect((await sql<{ n: number }>(`SELECT count(*)::int AS n FROM invoices WHERE source = 'sale'`))[0].n).toBe(1);
});

test("Owner makes an invoice by hand, issues and e-mails it, then marks it paid", async ({ page }) => {
  await signIn(page, "owner", "/admin/invoices");
  await expect(page.getByTestId("invoice-list")).toContainText("Thandi Mokoena");
  await page.getByTestId("new-invoice").click();
  await page.waitForURL(/\/admin\/invoices\/new/);
  await page.getByTestId("bill-name").fill("Green Thumb Landscaping");
  await page.getByTestId("bill-email").fill("accounts@greenthumb.test");
  await page.getByTestId("catalogue-search").fill("Iceberg");
  await page.getByRole("option", { name: /Iceberg Rose/ }).click();
  await page.getByTestId("add-line").click();
  await page.getByTestId("line-desc-1").fill("Delivery to site");
  await page.getByTestId("line-price-1").fill("250");
  await page.getByTestId("line-qty-0").fill("4");
  await expect(page.getByTestId("editor-total")).toHaveText("R886.00");
  await expect(page.getByTestId("doc-total")).toHaveText("R886.00"); // live preview
  await page.getByRole("button", { name: "14 days" }).click();
  await page.getByTestId("issue-send").click();
  await page.waitForURL(/\/admin\/invoices\/[0-9a-f-]{36}\?done=send/);
  await expect(page.getByText(/issued and e-mailed to accounts@greenthumb.test/)).toBeVisible();
  await expect(page.getByTestId("invoice-status")).toHaveText("Awaiting payment");
  expect(mails().at(-1).to).toBe("accounts@greenthumb.test");
  // Invoicing by hand never moves stock (6 received − 1 sold at the till).
  expect((await sql<{ on_hand: number }>(`SELECT on_hand FROM variants WHERE sku = $1`, [SKU]))[0].on_hand).toBe(5);

  const pdf = await page.request.get(await page.getByTestId("download-pdf").getAttribute("href") as string);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");

  await page.getByTestId("mark-paid").click();
  await page.getByText("EFT / bank transfer").click();
  await page.getByTestId("confirm-paid").click();
  await expect(page.getByTestId("invoice-status")).toHaveText("Paid");
  await expect(page.getByTestId("invoice-activity")).toContainText("Paid by eft / bank transfer");
});

test("Cashiers can't open the invoices section", async ({ page }) => {
  await signIn(page, "cashier", "/till");
  await page.goto("/admin/invoices");
  await expect(page).toHaveURL(/forbidden|login/);
});
