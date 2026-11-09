import { test, expect, devices } from "@playwright/test";
import { signIn, sql } from "./fixtures";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { defaultBrowserType, ...phone } = devices["Pixel 7"];

test.describe("owner screens on a phone", () => {
  test.use(phone);

  test("owner workspace is usable on a phone", async ({ page }) => {
    await signIn(page, "owner", "/admin");
    for (const path of ["/admin", "/till", "/admin/products", "/admin/receive", "/admin/stock", "/admin/labels", "/till/receipts", "/admin/reports", "/admin/import-export", "/admin/settings"]) {
      await page.goto(path);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${path} scrolls sideways`).toBeLessThanOrEqual(0);
    }
  });
});

test("the public website is gone: the root goes to sign-in", async ({ request }) => {
  for (const path of ["/", "/plants", "/plants/lavender", "/visit"]) {
    const r = await request.get(path, { maxRedirects: 0 });
    expect([307, 404], path).toContain(r.status());
    if (r.status() === 307) expect(r.headers()["location"]).toMatch(/\/(till|login)/);
  }
});

test("anonymous requests to private data are refused", async ({ request }) => {
  for (const url of ["/api/till/search?q=lav", "/api/till/lookup?code=21000001", "/api/reports/day?date=2026-01-01", "/api/labels/1"]) {
    const r = await request.get(url);
    expect(r.status(), url).toBe(401);
  }
  const page = await request.get("/admin/stock", { maxRedirects: 0 });
  expect(page.status()).toBe(307);
  expect(page.headers()["location"]).toContain("/login");
});

test("cashier cannot open owner pages, edit prices or read reports", async ({ page }) => {
  await signIn(page, "cashier");
  const [p] = await sql<{ product_id: number }>(`SELECT product_id FROM variants WHERE sku = 'LAV-15'`);
  await page.goto(`/admin/products/${p.product_id}`);
  await expect(page).toHaveURL(/\/forbidden/);
  await expect(page.getByRole("heading", { name: "Owner access only" })).toBeVisible();
  const r = await page.request.get("/api/reports/day?date=2026-01-01");
  expect(r.status()).toBe(403);
  // The till offers no price editing, and the price is unchanged
  await page.goto("/till");
  await expect(page.getByText("Owner workspace")).toHaveCount(0);
  const [{ price_cents }] = await sql<{ price_cents: number }>(`SELECT price_cents FROM variants WHERE sku = 'LAV-15'`);
  expect(price_cents).toBe(8990);
});

test("deactivated cashier is signed out and cannot sign in", async ({ page, browser }) => {
  await signIn(page, "cashier");
  const owner = await (await browser.newContext()).newPage();
  await signIn(owner, "owner", "/admin/staff");
  owner.on("dialog", (d) => d.accept());
  await owner.getByRole("button", { name: "Deactivate" }).click();
  await expect(owner.getByText("Deactivated and signed out everywhere.")).toBeVisible();
  await page.goto("/till");
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("E-mail").fill("cashier@e2e.test");
  await page.getByLabel("Password").fill("cashier-password-1");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText(/Sign-in failed/)).toBeVisible();
  await owner.getByRole("button", { name: "Reactivate" }).click();
  await expect(owner.getByText("Reactivated.")).toBeVisible();
});
