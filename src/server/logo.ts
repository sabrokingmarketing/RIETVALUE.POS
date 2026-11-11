import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { uploadDir } from "./uploads";
import { getSettings } from "./settings";

export type Logo = { url: string; file: string; type: "png" | "jpg" };

/**
 * The nursery's own logo: the file uploaded in Settings → Invoices & logo, or else the logo
 * committed with the app at public/brand/logo.png (or .jpg). Null when neither exists —
 * invoices then show the business name only. No logo is ever drawn by the app itself.
 */
export async function currentLogo(logoFile?: string): Promise<Logo | null> {
  const f = logoFile ?? (await getSettings()).logo_file;
  if (/^[0-9a-f-]{36}\.(png|jpg)$/.test(f)) {
    const file = path.join(/*turbopackIgnore: true*/ uploadDir(), f);
    if (await exists(file)) return { url: `/media/${f}`, file, type: f.endsWith(".png") ? "png" : "jpg" };
  }
  for (const ext of ["png", "jpg"] as const) {
    const file = path.join(process.cwd(), "public", "brand", `logo.${ext}`);
    if (await exists(file)) return { url: `/brand/logo.${ext}`, file, type: ext };
  }
  return null;
}
async function exists(f: string) { try { await fs.access(f); return true; } catch { return false; } }
