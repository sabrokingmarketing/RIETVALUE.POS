/** Till failure paths in a real browser. Runs after journey.spec.ts (alphabetical order is not relied on: it creates its own stock). */
import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { signIn, onHandBySku, scan, expectAmountDue, sql } from "./fixtures";

test.describe.configure({ mode: "serial" });

const SKU = "SAFE-POT";
let code = "";

async function ensureStockAndTill() {
  const existing = await sql<{ barcode: string }>(`SELECT barcode FROM variants WHERE sku = $1`, [SKU]);
  if (!existing.length) {
    const [cat] = await sql<{ id: number }>(`SELECT id FROM categories WHERE slug = 'pots'`);
    const [p] = await sql<{ id: number }>(`INSERT INTO products (common_name, category_id, slug) VALUES ('Safety Pot', $1, 'safety-pot') RETURNING id`, [cat.id]);
    const [n] = await sql<{ n: number }>(`SELECT nextval('internal_barcode_seq')::int AS n`);
    const bc = `21${String(n.n).padStart(6, "0")}`;
    const [v] = await sql<{ id: number }>(`INSERT INTO variants (product_id, size_label, sku, barcode, price_cents, is_public) VALUES ($1,'25 cm',$2,$3,10000,true) RETURNING id`, [p.id, SKU, bc]);
    await sql(`INSERT INTO barcodes (code, variant_id, kind) VALUES ($1,$2,'internal')`, [bc, v.id]);
    const [owner] = await sql<{ id: string }>(`SELECT id FROM "user" WHERE role='owner' LIMIT 1`);
    await sql(`UPDATE variants SET on_hand = 5 WHERE id = $1`, [v.id]);
    await sql(`INSERT INTO stock_movements (variant_id, quantity, balance_after, reason, operator_id, source_type, source_ref) VALUES ($1,5,5,'receive',$2,'delivery','E2E-SETUP')`, [v.id, owner.id]);
  }
  code = (await sql<{ barcode: string }>(`SELECT barcode FROM variants WHERE sku = $1`, [SKU]))[0].barcode;
  const open = await sql(`SELECT 1 FROM till_sessions WHERE closed_at IS NULL`);
  if (!open.length) {
    const [owner] = await sql<{ id: string }>(`SELECT id FROM "user" WHERE role='owner' LIMIT 1`);
    await sql(`INSERT INTO till_sessions (opened_by, business_date, opening_float_cents) VALUES ($1, (now() AT TIME ZONE 'Africa/Johannesburg')::date, 0)`, [owner.id]);
  }
}

async function freshTill(page: Page) {
  await page.goto("/till");
  await page.evaluate(() => { localStorage.removeItem("till.basket.v1"); localStorage.removeItem("till.pending.v1"); });
  await page.reload();
}

test.beforeAll(ensureStockAndTill);

test("unknown barcode shows a message and leaves the basket intact", async ({ page }) => {
  await signIn(page, "cashier");
  await freshTill(page);
  await scan(page, code);
  await scan(page, "00000000999");
  await expect(page.getByRole("alert").filter({ hasText: "No item has the code 00000000999" })).toBeVisible();
  await expect(page.getByTestId("line-qty")).toHaveValue("1");
  await expectAmountDue(page, "R100.00");
  await expect(page.getByTestId("scan-input")).toBeFocused();
});

test("quantity field keeps focus while typing; scanning resumes after basket buttons", async ({ page }) => {
  await signIn(page, "cashier");
  await freshTill(page);
  await scan(page, code);
  const qty = page.getByTestId("line-qty");
  await qty.click();
  await qty.fill("3");
  await expect(qty).toBeFocused();
  await expectAmountDue(page, "R300.00");
  await page.getByRole("button", { name: "One fewer Safety Pot" }).click();
  await expect(page.getByTestId("scan-input")).toBeFocused();
  await expectAmountDue(page, "R200.00");
  // A scanner typing while a button has focus still lands in the scan field
  await page.getByRole("button", { name: "One more Safety Pot" }).focus();
  await page.keyboard.type(code);
  await page.keyboard.press("Enter");
  await expect(qty).toHaveValue("3");
});

test("insufficient cash blocks completion; rejected card then approved card", async ({ page }) => {
  await signIn(page, "cashier");
  await freshTill(page);
  await scan(page, code);
  await page.getByTestId("take-payment").click();
  await page.getByTestId("tendered").fill("50");
  await expect(page.getByTestId("change-preview")).toHaveText("R50.00 short");
  await expect(page.getByTestId("complete-cash")).toBeDisabled();

  const before = await onHandBySku(SKU);
  await page.getByRole("radio", { name: "Card" }).click();
  await page.getByTestId("card-declined").click();
  await expect(page.getByText("Card declined by the terminal. Nothing was charged.")).toBeVisible();
  expect(await onHandBySku(SKU)).toBe(before);
  expect((await sql(`SELECT 1 FROM declined_card_attempts`)).length).toBeGreaterThan(0);

  await page.getByRole("radio", { name: "Card" }).click();
  await page.getByTestId("card-ref").fill("AUTH 778899");
  await page.getByTestId("card-approved").click();
  await expect(page.getByTestId("sale-done")).toContainText("by card");
  expect(await onHandBySku(SKU)).toBe(before! - 1);
  const [p] = await sql<{ reference: string }>(`SELECT reference FROM payments WHERE method='card' ORDER BY id DESC LIMIT 1`);
  expect(p.reference).toBe("AUTH 778899");
});

test("lost response after commit: recovery finishes the same sale without charging twice", async ({ page }) => {
  await signIn(page, "cashier");
  await freshTill(page);
  await scan(page, code);
  const before = await onHandBySku(SKU);
  const salesBefore = (await sql<{ n: number }>(`SELECT count(*)::int AS n FROM sales`))[0].n;
  // Let the request reach the server and commit, then drop the response.
  await page.route("**/api/checkout", async (route) => { await route.fetch(); await route.abort("connectionreset"); }, { times: 1 });
  await page.getByTestId("take-payment").click();
  await page.getByRole("radio", { name: "Card" }).click();
  await page.getByTestId("card-approved").click();
  await expect(page.getByText("Connection lost while completing a sale")).toBeVisible();
  await expect(page.getByText("Do not take payment again.")).toBeVisible();
  expect((await sql<{ n: number }>(`SELECT count(*)::int AS n FROM sales`))[0].n).toBe(salesBefore + 1);
  // Survives a page reload (power cut / refresh)
  await page.reload();
  await expect(page.getByText("Connection lost while completing a sale")).toBeVisible();
  await page.getByRole("button", { name: "Check and finish sale" }).click();
  await expect(page.getByTestId("sale-done")).toBeVisible();
  expect((await sql<{ n: number }>(`SELECT count(*)::int AS n FROM sales`))[0].n).toBe(salesBefore + 1);
  expect(await onHandBySku(SKU)).toBe(before! - 1);
});

test("offline disables final checkout", async ({ page, context }) => {
  await signIn(page, "cashier");
  await freshTill(page);
  await scan(page, code);
  await context.setOffline(true);
  await expect(page.getByText("Offline — checkout is disabled")).toBeVisible();
  await expect(page.getByTestId("take-payment")).toBeDisabled();
  await context.setOffline(false);
  await expect(page.getByTestId("take-payment")).toBeEnabled({ timeout: 15000 });
});

test("stale price must be accepted before tender", async ({ page }) => {
  await signIn(page, "cashier");
  await freshTill(page);
  await scan(page, code);
  await expectAmountDue(page, "R100.00");
  await sql(`UPDATE variants SET price_cents = 12000 WHERE sku = $1`, [SKU]); // owner changed the price meanwhile
  await page.getByTestId("take-payment").click();
  const dialog = page.getByRole("dialog", { name: "Prices have changed" });
  await expect(dialog).toContainText("R100.00");
  await expect(dialog).toContainText("R120.00");
  await expect(dialog).toContainText("+R20.00 each");
  await dialog.getByRole("button", { name: "Accept new prices" }).click();
  await expectAmountDue(page, "R120.00");
  await page.getByTestId("take-payment").click();
  await expect(page.getByTestId("pay-due")).toHaveText("R120.00");
});

test("two sessions racing for the final pot: one sale, the other told which line", async ({ browser }) => {
  await sql(`UPDATE variants SET price_cents = 10000 WHERE sku = $1`, [SKU]);
  const [v] = await sql<{ id: number; on_hand: number }>(`SELECT id, on_hand FROM variants WHERE sku = $1`, [SKU]);
  if (v.on_hand > 1) {
    const [owner] = await sql<{ id: string }>(`SELECT id FROM "user" WHERE role='owner' LIMIT 1`);
    await sql(`UPDATE variants SET on_hand = 1 WHERE id = $1`, [v.id]);
    await sql(`INSERT INTO stock_movements (variant_id, quantity, balance_after, reason, operator_id, source_type, source_ref, note) VALUES ($1,$2,1,'count_correction',$3,'adjustment','E2E','test')`, [v.id, 1 - v.on_hand, owner.id]);
  }
  const pages = await Promise.all([1, 2].map(async () => { const ctx = await browser.newContext(); const p = await ctx.newPage(); await signIn(p, "cashier"); await freshTill(p); await scan(p, code); await expect(p.getByTestId("line-qty")).toHaveValue("1"); return p; }));
  for (const p of pages) { await p.getByTestId("take-payment").click(); await p.getByTestId("tendered").fill("100"); }
  await Promise.all(pages.map((p) => p.getByTestId("complete-cash").click()));
  const done = await Promise.all(pages.map((p) => p.getByTestId("sale-done").isVisible().then(async (x) => x || (await p.getByTestId("sale-done").waitFor({ timeout: 4000 }).then(() => true, () => false)))));
  expect(done.filter(Boolean)).toHaveLength(1);
  const loser = pages[done.indexOf(false)];
  await expect(loser.getByText(/Only 0 × Safety Pot — 25 cm in stock/).first()).toBeVisible();
  expect(await onHandBySku(SKU)).toBe(0);
});

test("duplicate checkout POST with the same key returns the original sale", async ({ page }) => {
  await signIn(page, "cashier");
  await sql(`UPDATE variants SET on_hand = on_hand + 2 WHERE sku = $1`, [SKU]);
  const [v] = await sql<{ id: number; on_hand: number }>(`SELECT id, on_hand FROM variants WHERE sku = $1`, [SKU]);
  const [owner] = await sql<{ id: string }>(`SELECT id FROM "user" WHERE role='owner' LIMIT 1`);
  await sql(`INSERT INTO stock_movements (variant_id, quantity, balance_after, reason, operator_id, source_type, source_ref, note) VALUES ($1,2,$2,'count_correction',$3,'adjustment','E2E','found')`, [v.id, v.on_hand, owner.id]);
  const body = { idempotencyKey: randomUUID(), lines: [{ variantId: v.id, quantity: 1, unitPriceCents: 10000 }], payment: { method: "cash", tenderedCents: 10000 } };
  const headers = { origin: "http://localhost:3100" };
  const [a, b] = await Promise.all([page.request.post("/api/checkout", { data: body, headers }), page.request.post("/api/checkout", { data: body, headers })]);
  const [ja, jb] = [await a.json(), await b.json()];
  expect(ja.receiptNo).toBe(jb.receiptNo);
  expect(await onHandBySku(SKU)).toBe(v.on_hand - 1);
  // Cross-site POSTs are refused
  const evil = await page.request.post("/api/checkout", { data: { ...body, idempotencyKey: randomUUID() }, headers: { origin: "https://evil.example" } });
  expect(evil.status()).toBe(403);
});
