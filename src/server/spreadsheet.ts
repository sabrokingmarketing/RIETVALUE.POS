import "server-only";
import ExcelJS from "exceljs";
import { AppError } from "./errors";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_ROWS = 20000;

export type Sheet = { format: "csv" | "xlsx"; headers: string[]; rows: { rowNo: number; cells: Record<string, string>; numericCells: string[] }[] };

/** RFC 4180 CSV parser (quotes, escaped quotes, CRLF/LF, BOM). Detects `;` delimiters. */
export function parseCsv(text: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const firstLine = text.slice(0, text.search(/\r?\n|$/));
  const delim = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += ch;
    } else if (ch === '"' && field === "") inQ = true;
    else if (ch === delim) { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += ch;
  }
  if (inQ) throw new AppError("VALIDATION", "The CSV file has an unclosed quote. Check the file and export it again.");
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function cellText(v: ExcelJS.CellValue): { text: string; numeric: boolean } {
  if (v === null || v === undefined) return { text: "", numeric: false };
  if (typeof v === "number") return { text: Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6), numeric: true };
  if (typeof v === "string") return { text: v, numeric: false };
  if (typeof v === "boolean") return { text: v ? "true" : "false", numeric: false };
  if (v instanceof Date) return { text: v.toISOString().slice(0, 10), numeric: false };
  if (typeof v === "object") {
    if ("richText" in v) return { text: v.richText.map((r) => r.text).join(""), numeric: false };
    if ("text" in v && typeof v.text === "string") return { text: v.text, numeric: false }; // hyperlink
    if ("result" in v) return cellText(v.result as ExcelJS.CellValue); // formula: use its cached result, never the formula
    if ("error" in v) return { text: "", numeric: false };
  }
  return { text: String(v), numeric: false };
}

/** Read the first worksheet of an XLSX or a CSV into header-keyed rows. Nothing is evaluated. */
export async function readSpreadsheet(fileName: string, bytes: Buffer): Promise<Sheet> {
  if (bytes.length === 0) throw new AppError("VALIDATION", "The file is empty.");
  if (bytes.length > MAX_FILE_BYTES) throw new AppError("VALIDATION", "The file is larger than 10 MB. Split it into smaller files.");
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const lower = fileName.toLowerCase();
  let format: "csv" | "xlsx";
  let grid: { text: string; numeric: boolean }[][];
  if (lower.endsWith(".xlsx") || isZip) {
    if (!isZip) throw new AppError("VALIDATION", "This is not a valid .xlsx file. Save it from Excel as “Excel Workbook (.xlsx)” or as CSV.");
    const wb = new ExcelJS.Workbook();
    try { await wb.xlsx.load(bytes as unknown as ArrayBuffer); }
    catch { throw new AppError("VALIDATION", "The spreadsheet could not be read. Save it again as .xlsx or CSV."); }
    const ws = wb.worksheets.find((w) => w.state === "visible" && w.name.toLowerCase() !== "instructions") ?? wb.worksheets[0];
    if (!ws) throw new AppError("VALIDATION", "The workbook has no worksheets.");
    grid = [];
    const width = ws.columnCount;
    ws.eachRow({ includeEmpty: true }, (r, n) => {
      const line: { text: string; numeric: boolean }[] = [];
      for (let c = 1; c <= width; c++) line.push(cellText(r.getCell(c).value));
      grid[n - 1] = line;
    });
    for (let i = 0; i < grid.length; i++) grid[i] ||= [];
    format = "xlsx";
  } else if (lower.endsWith(".csv") || lower.endsWith(".txt")) {
    const text = bytes.toString("utf8");
    if (text.includes("\u0000")) throw new AppError("VALIDATION", "This does not look like a text CSV file.");
    grid = parseCsv(text).map((r) => r.map((t) => ({ text: t, numeric: false })));
    format = "csv";
  } else {
    throw new AppError("VALIDATION", "Upload a .csv or .xlsx file.");
  }
  // Drop leading blank rows; the first non-blank row is the header row.
  let h = 0;
  while (h < grid.length && grid[h].every((c) => !c.text.trim())) h++;
  if (h >= grid.length) throw new AppError("VALIDATION", "The file has no header row.");
  const headers = grid[h].map((c, i) => c.text.trim() || `Column ${i + 1}`);
  const seen = new Set<string>();
  for (const x of headers) { if (seen.has(x.toLowerCase())) throw new AppError("VALIDATION", `Two columns are both called “${x}”. Rename one of them.`); seen.add(x.toLowerCase()); }
  const rows: Sheet["rows"] = [];
  for (let i = h + 1; i < grid.length; i++) {
    const line = grid[i];
    if (!line || line.every((c) => !c?.text.trim())) continue;
    const cells: Record<string, string> = {}; const numericCells: string[] = [];
    headers.forEach((hd, j) => { const c = line[j]; cells[hd] = c?.text ?? ""; if (c?.numeric) numericCells.push(hd); });
    rows.push({ rowNo: i + 1, cells, numericCells });
    if (rows.length > MAX_ROWS) throw new AppError("VALIDATION", `The file has more than ${MAX_ROWS.toLocaleString("en-ZA")} rows. Split it into smaller files.`);
  }
  if (rows.length === 0) throw new AppError("VALIDATION", "The file has a header row but no data rows.");
  return { format, headers, rows };
}

/** Neutralise spreadsheet formula injection in CSV output (=, +, -, @, tab, CR at the start). */
export function guardCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}
/** Reverse guardCell on import, so an exported file re-imports to identical values. */
export function unguardCell(s: string): string {
  return /^'[=+\-@\t\r]/.test(s) ? s.slice(1) : s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  const cell = (v: unknown) => { const s = guardCell(v); return /[",\r\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return "﻿" + [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

/**
 * XLSX output. Text columns are written as text cells with the Text number format, so
 * barcodes keep leading zeros and nothing is ever stored as a formula.
 */
export async function toXlsx(sheets: { name: string; header: string[]; rows: unknown[][]; numeric?: string[]; widths?: number[] }[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Nursery POS";
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name, { views: [{ state: "frozen", ySplit: 1 }] });
    ws.columns = s.header.map((h, i) => ({ header: h, key: h, width: s.widths?.[i] ?? Math.min(48, Math.max(12, h.length + 4)), style: s.numeric?.includes(h) ? {} : { numFmt: "@" } }));
    ws.getRow(1).font = { bold: true };
    for (const r of s.rows) {
      const row = ws.addRow(r.map((v, i) => {
        if (v === null || v === undefined || v === "") return null;
        return s.numeric?.includes(s.header[i]) && typeof v === "number" ? v : String(v);
      }));
      row.eachCell((c, col) => { if (!s.numeric?.includes(s.header[col - 1])) c.numFmt = "@"; });
    }
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
