import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { PDFDocument } from "pdf-lib";
import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";

const require = createRequire(import.meta.url);
let prepared = false;
function prepare() {
  if (prepared) return;
  // Load the decoder's WebAssembly from node_modules (no network).
  const wasm = fs.readFileSync(require.resolve("zxing-wasm/reader/zxing_reader.wasm"));
  prepareZXingModule({ overrides: { wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer }, fireImmediately: true });
  prepared = true;
}

export async function pdfPageSizesMm(pdf: Uint8Array) {
  const doc = await PDFDocument.load(pdf);
  return doc.getPages().map((p) => {
    const { width, height } = p.getSize();
    return { width: (width * 25.4) / 72, height: (height * 25.4) / 72 };
  });
}

/** Rasterise PDF pages (poppler pdftoppm, like a printer driver would) and decode every Code 128 symbol. */
export async function decodePdfBarcodes(pdf: Uint8Array, opts: { firstPage?: number; lastPage?: number; dpi?: number } = {}) {
  prepare();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "labels-"));
  const file = path.join(dir, "labels.pdf");
  fs.writeFileSync(file, pdf);
  const args = ["-r", String(opts.dpi ?? 300), "-gray", "-png"];
  if (opts.firstPage) args.push("-f", String(opts.firstPage));
  if (opts.lastPage) args.push("-l", String(opts.lastPage));
  execFileSync("pdftoppm", [...args, file, path.join(dir, "page")]);
  const pngs = fs.readdirSync(dir).filter((f) => f.endsWith(".png")).sort();
  const out: string[] = [];
  for (const png of pngs) {
    const results = await readBarcodes(new Uint8Array(fs.readFileSync(path.join(dir, png))), { formats: ["Code128"], maxNumberOfSymbols: 50 });
    // Sort top-to-bottom, left-to-right so results follow label order.
    results.sort((a, b) => (a.position.topLeft.y - b.position.topLeft.y) || (a.position.topLeft.x - b.position.topLeft.x));
    out.push(...results.map((r) => r.text));
  }
  fs.rmSync(dir, { recursive: true, force: true });
  return out;
}
