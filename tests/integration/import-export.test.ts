import http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { closePool, makeUser, resetDatabase } from "../support/db";
import { q, q1 } from "@/server/db";
import {
  createImportJob, validateJob, startJob, kickImportWorker, listRows, editRow, revalidateFailed, jobReport, processRow, getJob, cancelJob,
} from "@/server/importer";
import { exportProducts, importTemplate } from "@/server/exporter";
import { isBlockedAddress } from "@/server/image-fetch";
import { readSpreadsheet, parseCsv } from "@/server/spreadsheet";
import { lookupCode } from "@/server/catalog";
import { ledgerMismatches } from "@/server/stock";
import { autoMap, DEFAULT_OPTIONS, type ImportOptions } from "@/lib/import-fields";
import { AppError } from "@/server/errors";
import type { Actor } from "@/server/session-types";

let owner: Actor, cashier: Actor;
beforeAll(async () => { await resetDatabase(); owner = await makeUser("owner"); cashier = await makeUser("cashier"); });
afterAll(closePool);

const HEAD = ["product_handle", "product_name", "category", "pot_size", "sku", "barcode", "supplier_barcodes", "price", "quantity", "low_stock_threshold", "status", "description"];
async function xlsx(rows: (string | number)[][], header = HEAD, numericBarcode = false) {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet("Products");
  ws.addRow(header);
  for (const r of rows) {
    const row = ws.addRow(r);
    const bi = header.indexOf("barcode");
    if (bi >= 0 && !numericBarcode) { const cell = row.getCell(bi + 1); cell.numFmt = "@"; cell.value = r[bi] === "" ? null : String(r[bi]); }
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const csv = (rows: string[][], header = HEAD) => Buffer.from([header, ...rows].map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\n"));

async function runImport(name: string, buf: Buffer, opts: Partial<ImportOptions> = {}, mapping?: Record<string, string>) {
  const job = await createImportJob(owner, name, buf);
  const v = await validateJob(owner, job.id, { mapping: mapping ?? job.mapping, options: { ...DEFAULT_OPTIONS, downloadImages: false, ...opts } });
  if (v.counts.pending > 0) { await startJob(owner, job.id); await kickImportWorker(); }
  return { job: await getJob(owner, job.id), preview: v };
}
const variant = (sku: string) => q1<{ id: number; product_id: number; price_cents: number; on_hand: number; barcode: string; size_label: string; relabel_needed: boolean; archived: boolean }>(
  `SELECT id, product_id, price_cents, on_hand, barcode, size_label, relabel_needed, (archived_at IS NOT NULL) AS archived FROM variants WHERE sku = $1`, [sku]);

const PLANTS: (string | number)[][] = [
  ["lavender", "Lavender", "Herbs & lavender", "15 cm pot", "LAV-15", "", "", "89.90", 12, 3, "active", "Fragrant."],
  ["lavender", "Lavender", "Herbs & lavender", "20 cm pot", "LAV-20", "", "", "149.90", 6, 2, "active", "Fragrant."],
  ["wild-garlic", "Wild Garlic", "Indigenous", "15 cm pot", "WG-15", "00012345", "0060012345678|0060012345679", "54.90", 24, 5, "active", ""],
  ["wild-garlic", "Wild Garlic", "Indigenous", "4 L bag", "WG-4L", "", "", "99.90", 2, 3, "active", ""],
  ["terracotta", "Terracotta Pot", "Pots", "25 cm", "POT-25", "", "", "119.90", 10, 2, "active", ""],
];

describe("bulk import", () => {
  it("imports plants with several pot sizes, prices, stock and barcodes (leading zeros kept)", async () => {
    const { job, preview } = await runImport("plants.xlsx", await xlsx(PLANTS), { stock: "add" });
    expect(preview.actions.create).toBe(5);
    expect(preview.newProducts).toBe(3);
    expect(job.status).toBe("completed");
    expect(job.counts).toMatchObject({ ok: 5, failed: 0 });
    const lav15 = (await variant("LAV-15"))!, lav20 = (await variant("LAV-20"))!;
    expect(lav15.product_id).toBe(lav20.product_id); // two sizes of one plant
    expect([lav15.price_cents, lav15.on_hand, lav20.price_cents, lav20.on_hand]).toEqual([8990, 12, 14990, 6]);
    expect(lav15.barcode).toMatch(/^21\d{6}$/); // generated
    expect((await variant("WG-15"))!.barcode).toBe("00012345"); // supplied, leading zeros preserved
    expect((await lookupCode("0060012345679"))?.sku).toBe("WG-15"); // supplier alias scans
    const cats = await q<{ name: string; kind: string }>(`SELECT name, kind FROM categories ORDER BY name`);
    expect(cats).toContainEqual({ name: "Pots", kind: "pot" });
    expect(await ledgerMismatches()).toEqual([]);
    const mv = await q<{ reason: string; source_type: string }>(`SELECT reason, source_type FROM stock_movements WHERE variant_id = $1`, [lav15.id]);
    expect(mv).toEqual([{ reason: "receive", source_type: "import" }]);
  });

  it("export → re-import updates in place without duplicates, and price edits flag relabelling", async () => {
    const before = (await q1<{ n: number }>(`SELECT count(*)::int AS n FROM variants`))!.n;
    const exp = await exportProducts(owner, "xlsx");
    expect(exp.rows).toBe(5);
    const sheet = await readSpreadsheet("export.xlsx", exp.body);
    expect(sheet.rows.find((r) => r.cells.sku === "WG-15")!.cells.barcode).toBe("00012345");
    // Re-import unchanged with stock "set": nothing changes
    const same = await runImport("export.xlsx", exp.body, { stock: "set" });
    expect(same.preview.actions).toMatchObject({ create: 0, update: 0, unchanged: 5 });
    expect((await q1<{ n: number }>(`SELECT count(*)::int AS n FROM variants`))!.n).toBe(before);
    // Edit a price and a stock count in the exported file, re-import
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(exp.body as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]; const hdr = (ws.getRow(1).values as string[]);
    const col = (k: string) => hdr.indexOf(k);
    ws.eachRow((row, n) => { if (n > 1 && row.getCell(col("sku")).value === "LAV-15") { row.getCell(col("price")).value = "99.90"; row.getCell(col("quantity")).value = 11; } });
    const edited = Buffer.from(await wb.xlsx.writeBuffer());
    const upd = await runImport("edited.xlsx", edited, { stock: "set" });
    expect(upd.preview.actions).toMatchObject({ create: 0, update: 1, unchanged: 4 });
    const lav = (await variant("LAV-15"))!;
    expect([lav.price_cents, lav.on_hand, lav.relabel_needed]).toEqual([9990, 11, true]);
    expect((await q1<{ n: number }>(`SELECT count(*)::int AS n FROM variants`))!.n).toBe(before);
    expect(await ledgerMismatches()).toEqual([]);
  });

  it("re-processing or resuming a job never adds the same stock twice", async () => {
    const buf = csv([["fern", "Boston Fern", "Indoor", "17 cm pot", "FERN-17", "", "", "129.90", "8", "2", "active", ""]]);
    const job = await createImportJob(owner, "fern.csv", buf);
    await validateJob(owner, job.id, { mapping: job.mapping, options: { ...DEFAULT_OPTIONS, stock: "add", downloadImages: false } });
    await startJob(owner, job.id);
    await kickImportWorker();
    expect((await variant("FERN-17"))!.on_hand).toBe(8);
    // Simulate a crash/resume: the row is marked pending again and the job looks stalled.
    await q(`UPDATE import_rows SET status = 'pending' WHERE job_id = $1`, [job.id]);
    await q(`UPDATE import_jobs SET status = 'running', heartbeat_at = now() - interval '10 minutes' WHERE id = $1`, [job.id]);
    await kickImportWorker();
    await processRow(job.id, 2, owner, { ...DEFAULT_OPTIONS, stock: "add" });
    expect((await variant("FERN-17"))!.on_hand).toBe(8);
    expect((await q1<{ n: number }>(`SELECT count(*)::int AS n FROM stock_movements m JOIN variants v ON v.id = m.variant_id WHERE v.sku = 'FERN-17'`))!.n).toBe(1);
  });

  it("partial failures: bad rows are reported, good rows import, corrected rows import on retry", async () => {
    const rows: string[][] = [
      ["rose", "Iceberg Rose", "Roses", "10 L bag", "ROSE-10", "", "", "249.90", "7", "", "active", ""],      // ok
      ["rose", "Iceberg Rose", "Roses", "5 L bag", "ROSE-5", "", "", "abc", "3", "", "active", ""],           // bad price
      ["rose", "Iceberg Rose", "Roses", "3 L bag", "", "", "", "99.00", "3", "", "active", ""],               // missing SKU
      ["aloe", "Fan Aloe", "Succulents", "15 cm pot", "ALOE-15", "", "", "129.90", "4", "", "active", ""],    // ok
      ["aloe", "Fan Aloe", "Succulents", "15 cm pot", "ALOE-15B", "", "", "129.90", "4", "", "active", ""],   // same size twice
      ["aloe", "Fan Aloe", "Succulents", "20 cm pot", "ALOE-20", "00012345", "", "189.90", "1", "", "active", ""], // barcode taken by WG-15
      ["mint", "Mint", "Herbs", "8 cm pot", "DUP-1", "", "", "29.90", "", "", "active", ""],
      ["mint", "Mint", "Herbs", "10 cm pot", "DUP-1", "", "", "39.90", "", "", "active", ""],               // duplicate SKU in file
      ["sage", "Sage", "Herbs", "15 cm pot", "LAV-20", "", "", "79.90", "", "", "active", ""],              // SKU belongs to Lavender
      ["basil", "", "", "8 cm pot", "BASIL-8", "", "", "19.90", "", "", "active", ""],                     // new without name/category
    ];
    const { job, preview } = await runImport("mixed.csv", csv(rows), { stock: "add" });
    expect(preview.counts.failed).toBe(9);
    expect(job.counts).toMatchObject({ ok: 1, failed: 9 });
    // ALOE-15 itself failed because its size is duplicated in the file; ROSE-10 imported.
    expect(await variant("ROSE-10")).toBeTruthy();
    expect(await variant("ALOE-15")).toBeFalsy();
    const failed = await listRows(owner, job.id, { status: "failed" });
    const msg = (sku: string, rowNo?: number) => failed.find((r) => (rowNo ? r.rowNo === rowNo : r.sku === sku))!.message;
    expect(msg("ROSE-5")).toMatch(/Price “abc”/);
    expect(msg("", 4)).toMatch(/SKU is missing/);
    expect(msg("ALOE-15B")).toMatch(/appears twice/);
    expect(msg("ALOE-20")).toMatch(/00012345 is already registered/);
    expect(msg("DUP-1")).toMatch(/also appears on row/);
    expect(msg("LAV-20")).toMatch(/belongs to “Lavender”/);
    expect(msg("BASIL-8")).toMatch(/Product name is required/);
    // Correct two rows and retry
    await editRow(owner, job.id, 3, { price: "199.90" });
    await editRow(owner, job.id, 7, { barcode: "" });
    await revalidateFailed(owner, job.id);
    await kickImportWorker();
    const after = await getJob(owner, job.id);
    expect(after.counts).toMatchObject({ ok: 3, failed: 7 });
    expect((await variant("ROSE-5"))!.price_cents).toBe(19990);
    expect((await variant("ALOE-20"))!.barcode).toMatch(/^21\d{6}$/);
    // Results report lists every row
    const rep = await jobReport(owner, job.id, "csv");
    const lines = parseCsv(rep.body.toString("utf8"));
    expect(lines[0]).toEqual(["row", "sku", "product_name", "pot_size", "result", "action", "changes", "message", "warnings"]);
    expect(lines.filter((l) => l[4] === "imported")).toHaveLength(3);
  });

  it("modes: create-only skips existing SKUs, update-only skips new ones; blank cells keep or clear", async () => {
    const r1 = await runImport("c.csv", csv([["lavender", "Lavender", "Herbs & lavender", "15 cm pot", "LAV-15", "", "", "1.00", "", "", "", ""],
      ["new", "Thyme", "Herbs", "8 cm pot", "THY-8", "", "", "24.90", "", "", "", ""]]), { mode: "create_only" });
    expect(r1.job.counts).toMatchObject({ ok: 1, skipped: 1 });
    expect((await variant("LAV-15"))!.price_cents).toBe(9990);
    const r2 = await runImport("u.csv", csv([["", "", "", "", "THY-8", "", "", "26.90", "", "", "", ""], ["", "", "", "", "NEW-1", "", "", "1.00", "", "", "", ""]]), { mode: "update_only" });
    expect(r2.job.counts).toMatchObject({ ok: 1, skipped: 1 });
    expect((await variant("THY-8"))!.price_cents).toBe(2690);
    expect(await variant("NEW-1")).toBeFalsy();
    // Blank description: keep vs clear
    await runImport("k.csv", csv([["", "", "", "", "LAV-15", "", "", "", "", "", "", ""]]), { blanks: "keep" });
    expect((await q1<{ d: string }>(`SELECT p.description AS d FROM products p JOIN variants v ON v.product_id = p.id WHERE v.sku = 'LAV-15'`))!.d).toBe("Fragrant.");
    await runImport("k2.csv", csv([["", "", "", "", "LAV-15", "", "", "", "", "", "", ""]]), { blanks: "clear" });
    expect((await q1<{ d: string }>(`SELECT p.description AS d FROM products p JOIN variants v ON v.product_id = p.id WHERE v.sku = 'LAV-15'`))!.d).toBe("");
  });

  it("archiving through import stops the barcode scanning", async () => {
    await runImport("a.csv", csv([["", "", "", "", "POT-25", "", "", "", "", "", "archived", ""]]));
    expect((await variant("POT-25"))!.archived).toBe(true);
    const v = await lookupCode((await variant("POT-25"))!.barcode);
    expect(v?.archived).toBe(true);
  });

  it("rejects invalid files with a clear message and writes nothing", async () => {
    const bad = async (name: string, buf: Buffer, re: RegExp) => {
      const e = await createImportJob(owner, name, buf).then(() => null, (x) => x);
      expect(e).toBeInstanceOf(AppError); expect((e as AppError).message).toMatch(re);
    };
    await bad("empty.csv", Buffer.from(""), /empty/);
    await bad("fake.xlsx", Buffer.from("not a zip"), /not a valid .xlsx/);
    await bad("headers.csv", Buffer.from("sku,price\n"), /no data rows/);
    await bad("dupe.csv", Buffer.from("SKU,sku\nA,B\n"), /Two columns/);
    await bad("quote.csv", Buffer.from('sku,price\n"A,1\n'), /unclosed quote/);
    await bad("image.png", Buffer.from([0x89, 0x50, 0x4e, 0x47]), /\.csv or \.xlsx/);
    const j = await createImportJob(owner, "nosku.csv", Buffer.from("name,price\nA,1\n"));
    await expect(validateJob(owner, j.id, { mapping: { product_name: "name", price: "price" }, options: {} })).rejects.toThrow(/Map a column to SKU/);
    await expect(validateJob(owner, j.id, { mapping: { sku: "name", price: "name" }, options: {} })).rejects.toThrow(/mapped to two fields/);
  });

  it("warns when a barcode column was stored as numbers in Excel", async () => {
    const { job } = await runImport("num.xlsx", await xlsx([["oak", "Oak", "Trees", "20 L", "OAK-20", 12345678, "", "499.00", "", "", "", ""]], HEAD, true));
    const rows = await listRows(owner, job.id);
    expect(rows[0].warnings.join(" ")).toMatch(/stored as a number/);
  });

  it("validation and cancelling write nothing to the catalogue", async () => {
    const n = (await q1<{ n: number }>(`SELECT count(*)::int AS n FROM variants`))!.n;
    const job = await createImportJob(owner, "x.csv", csv([["zz", "Zinnia", "Annuals", "6-pack", "ZIN-6", "", "", "39.90", "5", "", "", ""]]));
    const v = await validateJob(owner, job.id, { mapping: job.mapping, options: { stock: "add" } });
    expect(v.actions.create).toBe(1);
    await cancelJob(owner, job.id);
    await kickImportWorker();
    expect((await q1<{ n: number }>(`SELECT count(*)::int AS n FROM variants`))!.n).toBe(n);
  });

  it("only owners can import; cashiers export a limited price list", async () => {
    await expect(createImportJob(cashier, "p.csv", csv([]))).rejects.toThrow(/Only the owner/);
    const exp = await exportProducts(cashier, "csv");
    const header = parseCsv(exp.body.toString("utf8"))[0];
    expect(header).toEqual(["product_name", "category", "pot_size", "sku", "barcode", "price", "quantity"]);
    const audits = await q<{ action: string }>(`SELECT action FROM audit_log WHERE action LIKE 'export.%' OR action LIKE 'import.%'`);
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(["export.products", "import.upload", "import.start", "import.complete"]));
  });

  it("guards CSV exports against formula injection and re-imports the exact value", async () => {
    await runImport("f.csv", csv([["evil", "=HYPERLINK(\"http://x\")", "Herbs", "8 cm pot", "EVIL-1", "", "", "10.00", "", "", "", "+cmd"]]));
    const exp = await exportProducts(owner, "csv", { term: "HYPERLINK" });
    const text = exp.body.toString("utf8");
    expect(text).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(text).toContain("'+cmd");
    const again = await runImport("f2.csv", exp.body, {});
    expect(again.preview.actions).toMatchObject({ unchanged: 1, create: 0, update: 0 });
    expect((await q1<{ n: string }>(`SELECT common_name AS n FROM products WHERE slug = 'evil'`))!.n).toBe('=HYPERLINK("http://x")');
  });

  it("template downloads in both formats and auto-maps cleanly", async () => {
    const x = await importTemplate("xlsx");
    const s = await readSpreadsheet(x.name, x.body);
    expect(Object.keys(autoMap(s.headers))).toHaveLength(15);
    expect(s.rows[0].cells.product_name).toMatch(/^EXAMPLE/);
    const c = await importTemplate("csv");
    expect(parseCsv(c.body.toString("utf8"))[0]).toHaveLength(15);
  });
});

describe("image import", () => {
  let server: http.Server; let port = 0;
  const png = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === "/ok.png") { res.writeHead(200, { "Content-Type": "image/png" }); res.end(png); }
      else if (req.url === "/text") { res.writeHead(200); res.end("hello"); }
      else { res.writeHead(404); res.end(); }
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    port = (server.address() as { port: number }).port;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("blocks internal addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "::1", "fd00::1", "::ffff:127.0.0.1", "0.0.0.0"]) expect(isBlockedAddress(ip), ip).toBe(true);
    for (const ip of ["8.8.8.8", "41.0.0.1", "2001:4860::8888"]) expect(isBlockedAddress(ip), ip).toBe(false);
  });

  it("stores downloaded photos, and reports failed downloads as row warnings", async () => {
    process.env.IMAGE_FETCH_ALLOW_LOCAL = "1";
    const header = ["product_handle", "product_name", "category", "pot_size", "sku", "price", "image_url"];
    const buf = csv([
      ["photo-plant", "Photo Plant", "Indoor", "12 cm pot", "PH-12", "59.90", `http://127.0.0.1:${port}/ok.png`],
      ["text-plant", "Text Plant", "Indoor", "12 cm pot", "TX-12", "59.90", `http://127.0.0.1:${port}/text`],
    ], header);
    // http:// is only accepted by the test escape hatch; normal validation requires https
    const job = await createImportJob(owner, "img.csv", buf);
    const mapped = await validateJob(owner, job.id, { mapping: job.mapping, options: { downloadImages: true } });
    expect(mapped.counts.failed).toBe(2); // validation insists on https://
    const rows = await listRows(owner, job.id, { status: "failed" });
    expect(rows[0].message).toMatch(/https:\/\//);
    // Feed https-shaped rows straight to the worker to exercise the download path
    await q(`UPDATE import_rows SET status = 'pending', message = '', data = jsonb_set(data, '{imageUrl}', to_jsonb(raw->>'image_url')), action = 'create' WHERE job_id = $1`, [job.id]);
    await processRow(job.id, 2, owner, { ...DEFAULT_OPTIONS, downloadImages: true });
    await processRow(job.id, 3, owner, { ...DEFAULT_OPTIONS, downloadImages: true });
    const p = await q1<{ photo_path: string; photo_source_url: string }>(`SELECT photo_path, photo_source_url FROM products WHERE slug = 'photo-plant'`);
    expect(p!.photo_path).toMatch(/^[0-9a-f-]{36}\.png$/);
    const r3 = (await listRows(owner, job.id)).find((r) => r.rowNo === 3)!;
    expect(r3.status).toBe("ok");
    expect(r3.warnings.join(" ")).toMatch(/Image not imported: The link did not return a JPEG, PNG or WebP image/);
    process.env.IMAGE_FETCH_ALLOW_LOCAL = "0";
  });
});
