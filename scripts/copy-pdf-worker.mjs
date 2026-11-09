// Copies the pdf.js worker into /public so the label preview can render PDFs in any browser.
import fs from "node:fs";
fs.copyFileSync("node_modules/pdfjs-dist/build/pdf.worker.min.mjs", "public/pdf.worker.min.mjs");
