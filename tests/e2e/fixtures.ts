import { expect, type Page } from "@playwright/test";
import pg from "pg";

export const USERS = {
  owner: { name: "Olivia Owner", email: "owner@e2e.test", password: "owner-password-1", role: "owner" },
  cashier: { name: "Cara Cashier", email: "cashier@e2e.test", password: "cashier-password-1", role: "cashier" },
} as const;

export async function signIn(page: Page, who: keyof typeof USERS, next = "/till") {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("E-mail").fill(USERS[who].email);
  await page.getByLabel("Password").fill(USERS[who].password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => u.pathname.startsWith(next));
}

const url = process.env.E2E_DATABASE_URL || "postgres://nursery:nursery@localhost:5432/nursery_e2e";
export async function sql<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return (await c.query(text, params)).rows as T[]; } finally { await c.end(); }
}

export async function onHandBySku(sku: string) {
  const [r] = await sql<{ on_hand: number }>(`SELECT on_hand FROM variants WHERE sku = $1`, [sku]);
  return r?.on_hand;
}

export async function scan(page: Page, code: string) {
  const input = page.getByTestId("scan-input");
  await input.fill(code);
  await input.press("Enter");
}

export async function expectAmountDue(page: Page, text: string) {
  await expect(page.getByTestId("amount-due")).toHaveText(text);
}
