import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { boolish } from "@/lib/zod-helpers";
import bwipjs from "bwip-js";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { q, q1, tx, type Db } from "./db";
import { AppError } from "./errors";
import { assertRole, type Actor } from "./session-types";
import { formatRand } from "@/lib/money";
import { audit } from "./audit";

export const MM = 72 / 25.4; // PDF points per millimetre
/** Narrowest bar we allow. 0.25 mm = 2 dots on a 203 dpi printer; below this, handheld scanners struggle. */
export const MIN_MODULE_MM = 0.25;
export const MIN_BAR_HEIGHT_MM = 5;
export const QUIET_ZONE_MODULES = 10;

export type LabelPreset = {
  id: number; name: string; kind: "roll" | "sheet";
  page_width_mm: number; page_height_mm: number; label_width_mm: number; label_height_mm: number;
  margin_top_mm: number; margin_left_mm: number; pitch_x_mm: number; pitch_y_mm: number;
  columns: number; rows: number; padding_mm: number; module_mm: number; is_default: boolean;
};

export type LabelData = { name: string; size: string; priceCents: number; code: string };

// ---------------------------------------------------------------------------
// Code 128 encoding (bwip-js), drawn as exact vector rectangles
// ---------------------------------------------------------------------------
/** Returns bar/space widths in modules, starting with a bar (includes start, check and stop symbols). */
export function code128Pattern(text: string): number[] {
  const raw = bwipjs.raw({ bcid: "code128", text }) as unknown as { sbs: number[] }[];
  return raw[0].sbs;
}

export function code128Modules(text: string): number {
  return code128Pattern(text).reduce((a, b) => a + b, 0);
}

function drawBarcode(page: PDFPage, text: string, xMm: number, yMm: number, moduleMm: number, heightMm: number) {
  const sbs = code128Pattern(text);
  let x = xMm;
  for (let i = 0; i < sbs.length; i++) {
    const w = sbs[i] * moduleMm;
    if (i % 2 === 0) {
      page.drawRectangle({ x: x * MM, y: yMm * MM, width: w * MM, height: heightMm * MM, color: rgb(0, 0, 0), borderWidth: 0 });
    }
    x += w;
  }
}

// ---------------------------------------------------------------------------
// Layout validation
// ---------------------------------------------------------------------------
type Layout = { nameSize: number; barHeightMm: number; barcodeWidthMm: number };

const NAME_MAX_PT = 9, NAME_MIN_PT = 6.5, SIZE_PT = 7, PRICE_PT = 13, HRI_PT = 6.5;
const PT_TO_MM = 25.4 / 72;

export function checkLayout(preset: LabelPreset, sampleCode: string): Layout {
  const errors: string[] = [];
  const w = Number(preset.label_width_mm), h = Number(preset.label_height_mm), pad = Number(preset.padding_mm), x = Number(preset.module_mm);
  if (x < MIN_MODULE_MM) errors.push(`Bar width ${x} mm is below the ${MIN_MODULE_MM} mm minimum for reliable scanning.`);
  const modules = code128Modules(sampleCode);
  const barcodeWidthMm = modules * x;
  const needed = (modules + 2 * QUIET_ZONE_MODULES) * x;
  if (needed > w + 1e-6) {
    errors.push(`The barcode for ${sampleCode} needs ${needed.toFixed(1)} mm including quiet zones, but the label is ${w} mm wide. Use a wider label or a smaller bar width.`);
  }
  if (barcodeWidthMm > w - 2 * pad + 1e-6) {
    errors.push(`The barcode (${barcodeWidthMm.toFixed(1)} mm) does not fit inside the ${pad} mm padding.`);
  }
  const textMm = (2 * NAME_MIN_PT * 1.15 + PRICE_PT * 1.05 + HRI_PT * 1.1) * PT_TO_MM + 1.2;
  const barHeightMm = Math.min(12, h - 2 * pad - textMm);
  if (barHeightMm < MIN_BAR_HEIGHT_MM) {
    errors.push(`The label is too short: only ${Math.max(0, barHeightMm).toFixed(1)} mm left for bars (minimum ${MIN_BAR_HEIGHT_MM} mm).`);
  }
  if (preset.kind === "sheet") {
    const pw = Number(preset.page_width_mm), ph = Number(preset.page_height_mm);
    const right = Number(preset.margin_left_mm) + (preset.columns - 1) * Number(preset.pitch_x_mm) + w;
    const bottom = Number(preset.margin_top_mm) + (preset.rows - 1) * Number(preset.pitch_y_mm) + h;
    if (right > pw + 0.01) errors.push(`Columns run off the page: they end at ${right.toFixed(1)} mm on a ${pw} mm page.`);
    if (bottom > ph + 0.01) errors.push(`Rows run off the page: they end at ${bottom.toFixed(1)} mm on a ${ph} mm page.`);
    if (Number(preset.pitch_x_mm) < w - 0.01 && preset.columns > 1) errors.push("Horizontal pitch is smaller than the label width, so labels overlap.");
    if (Number(preset.pitch_y_mm) < h - 0.01 && preset.rows > 1) errors.push("Vertical pitch is smaller than the label height, so labels overlap.");
  }
  if (errors.length) throw new AppError("LAYOUT", errors[0], { errors });
  return { nameSize: NAME_MAX_PT, barHeightMm, barcodeWidthMm };
}

// ---------------------------------------------------------------------------
// Text fitting
// ---------------------------------------------------------------------------
function wrapName(font: PDFFont, text: string, maxWidthPt: number): { lines: string[]; size: number } {
  for (let size = NAME_MAX_PT; size >= NAME_MIN_PT; size -= 0.5) {
    const lines = wrap(font, text, size, maxWidthPt);
    if (lines.length <= 2) return { lines, size };
  }
  // Still too long at the minimum size: keep two lines and ellipsise the second.
  const lines = wrap(font, text, NAME_MIN_PT, maxWidthPt);
  let second = lines.slice(1).join(" ");
  while (second.length > 1 && font.widthOfTextAtSize(second + "…", NAME_MIN_PT) > maxWidthPt) second = second.slice(0, -1);
  return { lines: [lines[0], second.trimEnd() + "…"], size: NAME_MIN_PT };
}

function wrap(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    let w = word;
    // Break a single over-long word.
    while (font.widthOfTextAtSize(w, size) > maxWidth && w.length > 1) {
      let cut = w.length - 1;
      while (cut > 1 && font.widthOfTextAtSize(w.slice(0, cut) + "-", size) > maxWidth) cut--;
      if (cur) { lines.push(cur); cur = ""; }
      lines.push(w.slice(0, cut) + "-");
      w = w.slice(cut);
    }
    const next = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) <= maxWidth) cur = next;
    else { if (cur) lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}

function fitOneLine(font: PDFFont, text: string, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(t + "…", size) > maxWidth) t = t.slice(0, -1);
  return t + "…";
}

let fontCache: { regular: Uint8Array; bold: Uint8Array } | null = null;
async function loadFonts() {
  if (!fontCache) {
    const dir = path.join(process.cwd(), "node_modules", "@fontsource", "poppins", "files");
    fontCache = {
      regular: await fs.readFile(path.join(dir, "poppins-latin-500-normal.woff")),
      bold: await fs.readFile(path.join(dir, "poppins-latin-700-normal.woff")),
    };
  }
  return fontCache;
}

// ---------------------------------------------------------------------------
// PDF rendering
// ---------------------------------------------------------------------------
export async function renderLabelsPdf(
  preset: LabelPreset,
  labels: LabelData[],
  opts: { startPosition?: number; outlines?: boolean; title?: string } = {},
): Promise<Uint8Array> {
  if (labels.length === 0) throw new AppError("VALIDATION", "Choose at least one label to print");
  if (labels.length > 2000) throw new AppError("VALIDATION", "That is more than 2 000 labels; print in smaller batches");
  // Validate against the longest code in the job.
  const longest = labels.reduce((a, b) => (code128Modules(b.code) > code128Modules(a.code) ? b : a));
  const layout = checkLayout(preset, longest.code);

  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const fonts = await loadFonts();
  const regular = await doc.embedFont(fonts.regular, { subset: true });
  const bold = await doc.embedFont(fonts.bold, { subset: true });
  doc.setTitle(opts.title ?? "Plant labels");
  doc.setCreator("Nursery POS");
  doc.setProducer("Nursery POS (pdf-lib)");

  const perPage = preset.kind === "roll" ? 1 : preset.columns * preset.rows;
  const start = preset.kind === "roll" ? 0 : Math.min(Math.max((opts.startPosition ?? 1) - 1, 0), perPage - 1);
  const pw = Number(preset.page_width_mm), ph = Number(preset.page_height_mm);
  const lw = Number(preset.label_width_mm), lh = Number(preset.label_height_mm), pad = Number(preset.padding_mm);
  const moduleMm = Number(preset.module_mm);

  let page: PDFPage | null = null;
  let slot = start;
  for (const label of labels) {
    if (!page || slot >= perPage) {
      if (page) slot = 0;
      page = doc.addPage([pw * MM, ph * MM]);
    }
    const col = slot % preset.columns;
    const row = Math.floor(slot / preset.columns);
    // Top-left of label in mm (PDF origin is bottom-left).
    const left = preset.kind === "roll" ? 0 : Number(preset.margin_left_mm) + col * Number(preset.pitch_x_mm);
    const top = preset.kind === "roll" ? 0 : Number(preset.margin_top_mm) + row * Number(preset.pitch_y_mm);
    const bottom = ph - top - lh;

    if (opts.outlines) {
      page.drawRectangle({ x: left * MM, y: bottom * MM, width: lw * MM, height: lh * MM, borderColor: rgb(0.75, 0.75, 0.75), borderWidth: 0.4 });
    }

    const innerW = (lw - 2 * pad) * MM;
    let cursorTop = (bottom + lh - pad) * MM; // in points, moving down

    // Plant name (bold, up to two lines, shrinks to fit)
    const name = wrapName(bold, label.name, innerW);
    for (const line of name.lines) {
      cursorTop -= name.size * 1.0;
      page.drawText(line, { x: (left + pad) * MM, y: cursorTop, size: name.size, font: bold, color: rgb(0, 0, 0) });
      cursorTop -= name.size * 0.15;
    }

    // Size (left) and price (right, large)
    const price = formatRand(label.priceCents);
    const priceW = bold.widthOfTextAtSize(price, PRICE_PT);
    cursorTop -= PRICE_PT * 0.95;
    page.drawText(price, { x: (left + lw - pad) * MM - priceW, y: cursorTop, size: PRICE_PT, font: bold, color: rgb(0, 0, 0) });
    const sizeText = fitOneLine(regular, label.size, SIZE_PT, innerW - priceW - 2 * MM);
    page.drawText(sizeText, { x: (left + pad) * MM, y: cursorTop, size: SIZE_PT, font: regular, color: rgb(0, 0, 0) });

    // Barcode, centred, with human-readable code beneath
    const hriY = (bottom + pad) * MM;
    const barsBottomMm = bottom + pad + HRI_PT * 1.1 * PT_TO_MM;
    const barsTopLimitMm = cursorTop / MM - 1.0;
    const barH = Math.min(layout.barHeightMm, barsTopLimitMm - barsBottomMm);
    if (barH < MIN_BAR_HEIGHT_MM - 1e-6) {
      throw new AppError("LAYOUT", `“${label.name}” leaves too little room for the barcode on this label size.`);
    }
    const bw = code128Modules(label.code) * moduleMm;
    const bx = left + (lw - bw) / 2;
    drawBarcode(page, label.code, bx, barsBottomMm, moduleMm, barH);
    const hriW = regular.widthOfTextAtSize(label.code, HRI_PT);
    page.drawText(label.code, { x: (left + lw / 2) * MM - hriW / 2, y: hriY, size: HRI_PT, font: regular, color: rgb(0, 0, 0) });

    slot++;
  }
  return doc.save();
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------
const PRESET_COLS = `id, name, kind, page_width_mm, page_height_mm, label_width_mm, label_height_mm, margin_top_mm, margin_left_mm,
  pitch_x_mm, pitch_y_mm, columns, rows, padding_mm, module_mm, is_default`;

export async function listPresets(db?: Db) {
  return q<LabelPreset>(`SELECT ${PRESET_COLS} FROM label_presets ORDER BY is_default DESC, id`, [], db);
}
export async function getPreset(id: number, db?: Db) {
  return q1<LabelPreset>(`SELECT ${PRESET_COLS} FROM label_presets WHERE id = $1`, [id], db);
}

const mm = (min: number, max: number) => z.coerce.number().min(min).max(max);
export const presetInput = z.object({
  name: z.string().trim().min(1).max(60),
  kind: z.enum(["roll", "sheet"]),
  pageWidthMm: mm(10, 500), pageHeightMm: mm(10, 500), labelWidthMm: mm(10, 300), labelHeightMm: mm(10, 300),
  marginTopMm: mm(0, 100), marginLeftMm: mm(0, 100), pitchXMm: mm(10, 300), pitchYMm: mm(10, 300),
  columns: z.coerce.number().int().min(1).max(10), rows: z.coerce.number().int().min(1).max(30),
  paddingMm: mm(0, 10), moduleMm: mm(MIN_MODULE_MM, 1),
  isDefault: boolish().default(false),
});

export async function savePreset(actor: Actor, id: number | null, input: z.input<typeof presetInput>) {
  assertRole(actor, ["owner"]);
  const r = presetInput.safeParse(input);
  if (!r.success) throw new AppError("VALIDATION", r.error.issues[0].message);
  const v = r.data;
  const preset: LabelPreset = {
    id: id ?? 0, name: v.name, kind: v.kind, page_width_mm: v.kind === "roll" ? v.labelWidthMm : v.pageWidthMm,
    page_height_mm: v.kind === "roll" ? v.labelHeightMm : v.pageHeightMm, label_width_mm: v.labelWidthMm, label_height_mm: v.labelHeightMm,
    margin_top_mm: v.kind === "roll" ? 0 : v.marginTopMm, margin_left_mm: v.kind === "roll" ? 0 : v.marginLeftMm,
    pitch_x_mm: v.kind === "roll" ? v.labelWidthMm : v.pitchXMm, pitch_y_mm: v.kind === "roll" ? v.labelHeightMm : v.pitchYMm,
    columns: v.kind === "roll" ? 1 : v.columns, rows: v.kind === "roll" ? 1 : v.rows, padding_mm: v.paddingMm, module_mm: v.moduleMm,
    is_default: v.isDefault,
  };
  checkLayout(preset, "21999999"); // reject layouts too small for our 8-digit internal codes
  return tx(async (c) => {
    if (preset.is_default) await c.query(`UPDATE label_presets SET is_default = false WHERE is_default`);
    const vals = [preset.name, preset.kind, preset.page_width_mm, preset.page_height_mm, preset.label_width_mm, preset.label_height_mm,
      preset.margin_top_mm, preset.margin_left_mm, preset.pitch_x_mm, preset.pitch_y_mm, preset.columns, preset.rows, preset.padding_mm,
      preset.module_mm, preset.is_default];
    let savedId = id;
    if (id) {
      const u = await q1<{ id: number }>(`UPDATE label_presets SET name=$2, kind=$3, page_width_mm=$4, page_height_mm=$5, label_width_mm=$6,
        label_height_mm=$7, margin_top_mm=$8, margin_left_mm=$9, pitch_x_mm=$10, pitch_y_mm=$11, columns=$12, rows=$13, padding_mm=$14,
        module_mm=$15, is_default=$16, updated_at=now() WHERE id=$1 RETURNING id`, [id, ...vals], c);
      if (!u) throw new AppError("NOT_FOUND", "Preset not found");
    } else {
      const ins = await q1<{ id: number }>(`INSERT INTO label_presets (name, kind, page_width_mm, page_height_mm, label_width_mm, label_height_mm,
        margin_top_mm, margin_left_mm, pitch_x_mm, pitch_y_mm, columns, rows, padding_mm, module_mm, is_default)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`, vals, c);
      savedId = ins!.id;
    }
    await audit(c, actor, "label_preset.save", "label_preset", savedId!, v);
    return savedId!;
  });
}

// ---------------------------------------------------------------------------
// Print jobs (never touch stock)
// ---------------------------------------------------------------------------
export const printJobInput = z.object({
  purpose: z.enum(["delivery", "batch", "reprint", "test", "relabel"]),
  presetId: z.coerce.number().int().positive(),
  deliveryId: z.coerce.number().int().positive().optional(),
  startPosition: z.coerce.number().int().min(1).max(300).default(1),
  items: z.array(z.object({
    variantId: z.coerce.number().int().positive(),
    quantity: z.coerce.number().int().min(0).max(1000),
  })).min(1, "Choose at least one item"),
});
export type PrintJobInput = z.input<typeof printJobInput>;

export async function createPrintJob(actor: Actor, input: PrintJobInput): Promise<{ jobId: number; labelCount: number }> {
  assertRole(actor, ["owner", "cashier"]);
  const r = printJobInput.safeParse(input);
  if (!r.success) throw new AppError("VALIDATION", r.error.issues[0].message);
  const data = r.data;
  let items = data.items.filter((i) => i.quantity > 0);
  if (data.purpose === "test") items = [{ variantId: items[0]?.variantId ?? data.items[0].variantId, quantity: 1 }];
  if (items.length === 0) throw new AppError("VALIDATION", "Set a quantity of at least 1 for one item");
  const preset = await getPreset(data.presetId);
  if (!preset) throw new AppError("NOT_FOUND", "Label preset not found");
  const labels = await labelsFor(items);
  checkLayout(preset, labels.reduce((a, b) => (b.code.length > a.code.length ? b : a)).code);
  const count = items.reduce((s, i) => s + i.quantity, 0);
  const job = await q1<{ id: number }>(
    `INSERT INTO label_print_jobs (purpose, preset_id, delivery_id, items, label_count, start_position, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [data.purpose, preset.id, data.deliveryId ?? null, JSON.stringify(items), count, data.startPosition, actor.id]);
  return { jobId: job!.id, labelCount: count };
}

/** Resolve current name, size, price and code from the database (never from the client). */
export async function labelsFor(items: { variantId: number; quantity: number }[], db?: Db): Promise<LabelData[]> {
  const ids = items.map((i) => i.variantId);
  const rows = await q<{ id: number; common_name: string; size_label: string; price_cents: number; barcode: string }>(
    `SELECT v.id, p.common_name, v.size_label, v.price_cents, v.barcode FROM variants v JOIN products p ON p.id = v.product_id
     WHERE v.id = ANY($1::int[])`, [ids], db);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out: LabelData[] = [];
  for (const i of items) {
    const v = byId.get(i.variantId);
    if (!v) throw new AppError("NOT_FOUND", "An item on this label job no longer exists");
    for (let n = 0; n < i.quantity; n++) out.push({ name: v.common_name, size: v.size_label, priceCents: v.price_cents, code: v.barcode });
  }
  return out;
}

export async function renderJob(actor: Actor, jobId: number, opts: { outlines?: boolean } = {}) {
  assertRole(actor, ["owner", "cashier"]);
  const job = await q1<{ id: number; preset_id: number; items: { variantId: number; quantity: number }[]; start_position: number; purpose: string }>(
    `SELECT id, preset_id, items, start_position, purpose FROM label_print_jobs WHERE id = $1`, [jobId]);
  if (!job) throw new AppError("NOT_FOUND", "Label job not found");
  const preset = await getPreset(job.preset_id);
  if (!preset) throw new AppError("NOT_FOUND", "Label preset not found");
  const labels = await labelsFor(job.items);
  const pdf = await renderLabelsPdf(preset, labels, { startPosition: job.start_position, outlines: opts.outlines, title: `Labels job ${job.id}` });
  return { pdf, preset, count: labels.length };
}

export async function recentPrintJobs(limit = 15) {
  return q<{ id: number; purpose: string; label_count: number; created_at: string; preset_name: string; created_by_name: string; items: { variantId: number; quantity: number }[] }>(
    `SELECT j.id, j.purpose, j.label_count, j.created_at, p.name AS preset_name, u.name AS created_by_name, j.items
     FROM label_print_jobs j JOIN label_presets p ON p.id = j.preset_id JOIN "user" u ON u.id = j.created_by
     ORDER BY j.created_at DESC LIMIT $1`, [limit]);
}

export async function logRelabelAudit(actor: Actor, jobId: number) {
  await audit(undefined, actor, "labels.print", "label_job", jobId, {});
}
