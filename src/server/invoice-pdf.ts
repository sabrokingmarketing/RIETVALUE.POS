import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { PDFDocument, degrees, rgb, type PDFFont, type PDFImage, type PDFPage, type RGB } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { Invoice } from "./invoices";
import { invoiceBadge, invoiceTitle, PAID_METHODS, saDate, shortDate, type InvoiceBadge } from "@/lib/invoice-format";
export { shortDate };
import { formatRand } from "@/lib/money";
import { LOGO_PARTS } from "@/lib/brand-logo";
import { uploadDir } from "./uploads";

const MM = 72 / 25.4;
const W = 210, H = 297, MX = 16;
const hex = (h: string): RGB => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
const C = {
  ink: hex("#17211B"), muted: hex("#647067"), deep: hex("#365314"), line: hex("#E5E7EB"), soft: hex("#ECFCCB"),
  lime: hex("#A3E635"), white: rgb(1, 1, 1), mist: hex("#F7F9F6"), danger: hex("#B42318"), warn: hex("#8A5A00"), warnBg: hex("#FFF4DC"),
};

let fontCache: Record<"regular" | "medium" | "semibold" | "bold", Uint8Array> | null = null;
async function loadFonts() {
  if (!fontCache) {
    const dir = path.join(process.cwd(), "node_modules", "@fontsource", "poppins", "files");
    const f = (w: number) => fs.readFile(path.join(dir, `poppins-latin-${w}-normal.woff`));
    fontCache = { regular: await f(400), medium: await f(500), semibold: await f(600), bold: await f(700) };
  }
  return fontCache;
}

async function loadLogo(doc: PDFDocument, logoFile: string): Promise<PDFImage | null> {
  if (!/^[0-9a-f-]{36}\.(png|jpg)$/.test(logoFile)) return null;
  try {
    const bytes = await fs.readFile(path.join(/*turbopackIgnore: true*/ uploadDir(), logoFile));
    return logoFile.endsWith(".png") ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
  } catch { return null; }
}

/** Renders the invoice as an A4 PDF. Everything shown comes from the invoice record and its snapshot. */
export async function renderInvoicePdf(inv: Invoice, opts: { logoFile?: string } = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const f = await loadFonts();
  const R = await doc.embedFont(f.regular, { subset: true });
  const M = await doc.embedFont(f.medium, { subset: true });
  const SB = await doc.embedFont(f.semibold, { subset: true });
  const B = await doc.embedFont(f.bold, { subset: true });
  const b = inv.business_snapshot;
  const title = invoiceTitle(inv).toUpperCase();
  const number = inv.invoice_no ?? "DRAFT";
  doc.setTitle(`${invoiceTitle(inv)} ${number} — ${b.business_name}`);
  doc.setAuthor(b.business_name);
  doc.setCreator("Rietvalei POS");
  const logo = opts.logoFile ? await loadLogo(doc, opts.logoFile) : null;

  const charset = new Set(B.getCharacterSet());
  const clean = (t: string) => Array.from(t.replace(/\r/g, "")).map((ch) => (ch === "\n" || charset.has(ch.codePointAt(0)!) ? ch : "?")).join("");

  // --- drawing helpers (y measured from the top of the page in mm) ---
  let page!: PDFPage;
  const text = (t: string, x: number, y: number, font: PDFFont, size: number, color = C.ink, align: "left" | "right" | "center" = "left", spacing = 0) => {
    const s = clean(t);
    const w = font.widthOfTextAtSize(s, size) + spacing * Math.max(0, s.length - 1);
    const px = align === "right" ? x * MM - w : align === "center" ? x * MM - w / 2 : x * MM;
    page.drawText(s, { x: px, y: (H - y) * MM - size * 0.78, size, font, color, characterSpacing: spacing || undefined } as never);
  };
  const rect = (x: number, y: number, w: number, h: number, color: RGB) => page.drawRectangle({ x: x * MM, y: (H - y - h) * MM, width: w * MM, height: h * MM, color });
  const hline = (x1: number, x2: number, y: number, color = C.line, t = 0.6) => page.drawLine({ start: { x: x1 * MM, y: (H - y) * MM }, end: { x: x2 * MM, y: (H - y) * MM }, thickness: t, color });
  const vline = (x: number, y1: number, y2: number) => page.drawLine({ start: { x: x * MM, y: (H - y1) * MM }, end: { x: x * MM, y: (H - y2) * MM }, thickness: 0.6, color: C.line });
  const pill = (label: string, x: number, y: number, tone: InvoiceBadge["tone"]) => {
    const size = 7.5; const w = SB.widthOfTextAtSize(label, size) / MM + 6; const h = 5.4;
    const [bg, fg] = tone === "green" ? [C.soft, C.deep] : tone === "danger" ? [hex("#FDECEA"), C.danger] : tone === "warn" ? [C.warnBg, C.warn] : [C.mist, C.muted];
    page.drawSvgPath(`M${h / 2} 0 H${w - h / 2} A${h / 2} ${h / 2} 0 0 1 ${w - h / 2} ${h} H${h / 2} A${h / 2} ${h / 2} 0 0 1 ${h / 2} 0 Z`,
      { x: x * MM, y: (H - y) * MM, scale: MM, color: bg });
    text(label, x + w / 2, y + 1.15, SB, size, fg, "center");
    return w;
  };
  const wrap = (t: string, font: PDFFont, size: number, maxMm: number): string[] => {
    const out: string[] = [];
    for (const para of clean(t).split("\n")) {
      let cur = "";
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const next = cur ? `${cur} ${word}` : word;
        if (font.widthOfTextAtSize(next, size) / MM <= maxMm) { cur = next; continue; }
        if (cur) out.push(cur);
        let w = word;
        while (font.widthOfTextAtSize(w, size) / MM > maxMm && w.length > 1) {
          let cut = w.length - 1;
          while (cut > 1 && font.widthOfTextAtSize(w.slice(0, cut), size) / MM > maxMm) cut--;
          out.push(w.slice(0, cut)); w = w.slice(cut);
        }
        cur = w;
      }
      out.push(cur);
    }
    while (out.length && out[out.length - 1] === "") out.pop();
    return out;
  };

  const badge = invoiceBadge(inv);
  const contact = [b.phone && `Tel ${b.phone}`, b.email].filter(Boolean).join("  ·  ");
  let pageNo = 0;
  const pages: PDFPage[] = [];

  const newPage = (first: boolean) => {
    page = doc.addPage([W * MM, H * MM]); pages.push(page); pageNo++;
    rect(0, 0, W, 3.2, C.deep); rect(0, 3.2, W, 1.2, C.lime);
    if (!first) {
      text(`${title}  ${number}`, MX, 12, SB, 9, C.muted);
      text(b.business_name, W - MX, 12, SB, 9, C.muted, "right");
      return 22;
    }
    // Title block
    text(title, MX, 15, B, 26, C.ink, "left", 0.4);
    text(number, MX, 27.5, M, 11, C.muted);
    pill(badge.label, MX + M.widthOfTextAtSize(number, 11) / MM + 4, 27.6, badge.tone);
    // Brand block (right)
    if (logo) {
      const box = { w: 62, h: 28 }; const s = Math.min((box.w * MM) / logo.width, (box.h * MM) / logo.height);
      const w = logo.width * s, h = logo.height * s;
      page.drawImage(logo, { x: (W - MX) * MM - w, y: (H - 13) * MM - h, width: w, height: h });
    } else {
      const size = 26, x0 = W - MX - size, y0 = 12;
      for (const p of LOGO_PARTS) {
        page.drawSvgPath(p.d, { x: x0 * MM, y: (H - y0) * MM, scale: (size / 100) * MM, color: p.fill ? hex(p.fill) : undefined,
          borderColor: p.stroke ? hex(p.stroke) : undefined, borderWidth: p.width ? p.width * (size / 100) * MM : undefined, borderLineCap: 1 } as never);
      }
      const nx = x0 - 4;
      const nameLines = wrap(b.business_name, B, 13, 70).slice(0, 2);
      let ny = 16 + (nameLines.length === 1 ? 2.5 : 0);
      for (const l of nameLines) { text(l, nx, ny, B, 13, C.deep, "right"); ny += 6; }
      if (b.legal_name && b.legal_name !== b.business_name) text(b.legal_name, nx, ny, R, 8, C.muted, "right");
    }
    return 44;
  };

  let y = newPage(true);

  // --- Bill from / Bill to / Dates band ---
  const colW = (W - 2 * MX) / 3;
  const label = (t: string, x: number, yy: number) => text(t.toUpperCase(), x, yy, SB, 6.8, C.muted, "left", 0.6);
  const fromLines: [string, PDFFont, RGB][] = [
    [b.business_name, SB, C.ink],
    ...(b.legal_name && b.legal_name !== b.business_name ? [[b.legal_name, R, C.muted] as [string, PDFFont, RGB]] : []),
    ...b.address_lines.split("\n").filter(Boolean).map((l) => [l, R, C.muted] as [string, PDFFont, RGB]),
    ...(b.phone ? [[`Tel ${b.phone}`, R, C.muted] as [string, PDFFont, RGB]] : []),
    ...(b.email ? [[b.email, R, C.muted] as [string, PDFFont, RGB]] : []),
    ...(b.vat_number ? [[`VAT no. ${b.vat_number}`, M, C.ink] as [string, PDFFont, RGB]] : []),
    ...(b.registration_no ? [[`Reg. no. ${b.registration_no}`, R, C.muted] as [string, PDFFont, RGB]] : []),
  ];
  const toLines: [string, PDFFont, RGB][] = [
    [inv.bill_name || "—", SB, C.ink],
    ...(inv.bill_company ? [[inv.bill_company, M, C.ink] as [string, PDFFont, RGB]] : []),
    ...inv.bill_address.split("\n").filter(Boolean).map((l) => [l, R, C.muted] as [string, PDFFont, RGB]),
    ...(inv.bill_email ? [[inv.bill_email, R, C.muted] as [string, PDFFont, RGB]] : []),
    ...(inv.bill_phone ? [[`Tel ${inv.bill_phone}`, R, C.muted] as [string, PDFFont, RGB]] : []),
    ...(inv.bill_vat_number ? [[`VAT no. ${inv.bill_vat_number}`, M, C.ink] as [string, PDFFont, RGB]] : []),
  ];
  const wrapCol = (ls: [string, PDFFont, RGB][]) => ls.flatMap(([t, font, c]) => wrap(t, font, 8.6, colW - 9).map((w) => [w, font, c] as [string, PDFFont, RGB]));
  const fromW = wrapCol(fromLines).slice(0, 10), toW = wrapCol(toLines).slice(0, 10);
  const dates: [string, string][] = [
    ["Issue date", shortDate(inv.issue_date)],
    [inv.status === "paid" ? "Paid on" : "Due date", inv.status === "paid" && inv.paid_at ? shortDate(saDate(inv.paid_at)) : inv.due_date && inv.due_date !== inv.issue_date ? shortDate(inv.due_date) : "On receipt"],
    ...(inv.reference ? [["Reference", inv.reference] as [string, string]] : []),
  ];
  const bandH = Math.max(fromW.length, toW.length, dates.length * 2.4) * 4.3 + 15;
  hline(MX, W - MX, y, C.line, 0.8); hline(MX, W - MX, y + bandH, C.line, 0.8);
  vline(MX + colW, y + 3, y + bandH - 3); vline(MX + 2 * colW, y + 3, y + bandH - 3);
  label("Bill from", MX, y + 5); label("Bill to", MX + colW + 5, y + 5);
  let yy = y + 11; for (const [t, font, c] of fromW) { text(t, MX, yy, font, 8.6, c); yy += 4.3; }
  yy = y + 11; for (const [t, font, c] of toW) { text(t, MX + colW + 5, yy, font, 8.6, c); yy += 4.3; }
  yy = y + 5; for (const [k, v] of dates) { label(k, MX + 2 * colW + 5, yy); text(v, MX + 2 * colW + 5, yy + 4.4, SB, 9, C.ink); yy += 10.4; }
  y += bandH + 9;

  // --- Line items ---
  const X = { desc: MX + 4, price: W - MX - 62, qty: W - MX - 34, total: W - MX - 4 };
  const descW = X.price - 22 - X.desc;
  const tableHead = () => {
    rect(MX, y, W - 2 * MX, 9, C.soft);
    const hy = y + 3.2;
    text("DESCRIPTION", X.desc, hy, SB, 7, C.deep, "left", 0.5);
    text("PRICE", X.price, hy, SB, 7, C.deep, "right", 0.5);
    text("QTY", X.qty, hy, SB, 7, C.deep, "center", 0.5);
    text("TOTAL", X.total, hy, SB, 7, C.deep, "right", 0.5);
    y += 9;
  };
  const FOOT = H - 22; // content must stay above the footer bar
  tableHead();
  for (const l of inv.lines) {
    const dl = wrap(l.description, M, 9, descW).slice(0, 3);
    const rowH = Math.max(10.5, dl.length * 4.4 + (l.sku ? 4 : 0) + 5);
    if (y + rowH > FOOT - 4) { y = newPage(false); tableHead(); }
    let ly = y + 3.2;
    for (const t of dl) { text(t, X.desc, ly, M, 9, C.ink); ly += 4.4; }
    if (l.sku) text(l.sku, X.desc, ly, R, 7, C.muted);
    text(formatRand(l.unit_price_cents), X.price, y + 3.2, R, 9, C.ink, "right");
    text(String(l.quantity), X.qty, y + 3.2, R, 9, C.ink, "center");
    text(formatRand(l.line_total_cents), X.total, y + 3.2, SB, 9, C.ink, "right");
    y += rowH;
    hline(MX, W - MX, y);
  }

  // --- Totals + payment information ---
  const tW = 78, tX = W - MX - tW;
  const rows: [string, string][] = inv.vat_registered
    ? [["Subtotal (excl. VAT)", formatRand(inv.subtotal_cents)], [`VAT ${(b.vat_rate_bp / 100).toLocaleString("en-ZA")}%`, formatRand(inv.vat_cents)]]
    : [["Subtotal", formatRand(inv.total_cents)]];
  const paid = inv.status === "paid";
  const infoW = tX - MX - 10;
  const payLines = inv.payment_info ? wrap(inv.payment_info, R, 8.2, infoW) : [];
  const noteLines = inv.notes ? wrap(inv.notes, R, 8.2, infoW) : [];
  const leftH = (payLines.length ? payLines.length * 4 + 9 : 0) + (noteLines.length ? noteLines.length * 4 + 9 : 0);
  const rightH = rows.length * 8 + 16 + (paid ? 16 : 0);
  if (y + 8 + Math.max(leftH, rightH) > FOOT - 4) y = newPage(false);
  y += 6;
  let ty = y;
  for (const [k, v] of rows) {
    text(k, tX + 4, ty + 2, R, 8.8, C.muted); text(v, W - MX - 4, ty + 2, M, 8.8, C.ink, "right");
    ty += 8; hline(tX, W - MX, ty);
  }
  ty += 2;
  rect(tX, ty, tW, 12, paid ? C.mist : C.deep);
  text(paid ? "Total" : "Total due", tX + 4, ty + 3.6, SB, 10, paid ? C.ink : C.white);
  text(formatRand(inv.total_cents), W - MX - 4, ty + 2.6, B, 13, paid ? C.ink : C.white, "right");
  ty += 12;
  if (paid) {
    const how = inv.paid_method ? PAID_METHODS[inv.paid_method] : "";
    text(`Paid${how ? ` · ${how}` : ""}${inv.paid_at ? ` · ${shortDate(saDate(inv.paid_at))}` : ""}`, tX + 4, ty + 3, R, 8, C.deep);
    rect(tX, ty + 8, tW, 10, C.soft);
    text("Balance due", tX + 4, ty + 10.6, SB, 9, C.deep);
    text(formatRand(0), W - MX - 4, ty + 10.2, B, 11, C.deep, "right");
  }
  let ly = y;
  if (payLines.length) {
    label("Payment information", MX, ly); ly += 5.5;
    for (const t of payLines) { text(t, MX, ly, R, 8.2, C.ink); ly += 4; }
    ly += 3.5;
  }
  if (noteLines.length) {
    label("Notes", MX, ly); ly += 5.5;
    for (const t of noteLines) { text(t, MX, ly, R, 8.2, C.ink); ly += 4; }
  }
  if (!payLines.length && !noteLines.length && inv.source === "sale") {
    label("Payment", MX, ly); ly += 5.5;
    text(`Paid in full at the till${inv.receipt_no ? ` (receipt ${inv.receipt_no})` : ""}.`, MX, ly, R, 8.2, C.ink);
  }

  // --- Watermarks, footer bar and page numbers on every page ---
  for (const [i, p] of pages.entries()) {
    page = p;
    if (inv.status === "void" || inv.status === "draft") {
      const word = inv.status === "void" ? "VOID" : "DRAFT";
      const size = 110; const w = B.widthOfTextAtSize(word, size);
      p.drawText(word, { x: (W / 2) * MM - (w / 2) * Math.cos(Math.PI / 6) + 30, y: (H / 2) * MM - (w / 2) * Math.sin(Math.PI / 6), size, font: B,
        color: inv.status === "void" ? C.danger : C.muted, opacity: 0.08, rotate: degrees(30) });
    }
    rect(0, H - 16, W, 16, C.deep); rect(0, H - 16, W, 0.9, C.lime);
    text(clean(b.thanks || "Thank you for your business!"), MX, H - 10.6, SB, 10, C.white);
    const right = pages.length > 1 ? `${contact}${contact ? "   " : ""}Page ${i + 1} of ${pages.length}` : contact;
    if (right) text(right, W - MX, H - 10.2, R, 7.8, hex("#D9F99D"), "right");
    if (inv.status === "void" && i === 0) text(`Voided: ${inv.void_reason}`.slice(0, 120), MX, H - 22, M, 8, C.danger);
  }
  void pageNo;
  return doc.save();
}
