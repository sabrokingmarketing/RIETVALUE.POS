// ---------------------------------------------------------------- IMPORT / EXPORT (owner)
const IF = [
  ["product_handle", "Product handle", "", ["handle", "product id", "product key", "slug", "parent"]],
  ["product_name", "Product name", "new", ["name", "common name", "product", "title", "plant"]],
  ["botanical_name", "Botanical name", "", ["botanical", "latin name", "scientific name"]],
  ["category", "Category", "new", ["categories", "type", "group", "department"]],
  ["pot_size", "Pot / pack size", "new", ["size", "pot size", "pack size", "variation", "variant", "option"]],
  ["sku", "SKU", "always", ["sku code", "item code", "stock code", "product code"]],
  ["barcode", "Barcode", "", ["ean", "upc", "gtin", "barcode number", "label barcode"]],
  ["supplier_barcodes", "Supplier barcodes (| separated)", "", ["supplier barcode", "alias barcodes", "aliases"]],
  ["price", "Selling price (R)", "new", ["selling price", "retail price", "price incl vat", "sell price", "rrp"]],
  ["quantity", "Stock quantity", "", ["qty", "stock", "on hand", "quantity on hand", "inventory"]],
  ["low_stock_threshold", "Low-stock warning at", "", ["low stock", "reorder level", "reorder point", "min stock"]],
  ["status", "Status (active / archived)", "", ["publication status", "published", "state"]],
];
const MAX_IMPORT_ROWS = 1500, MAX_SIZES = 600;
const normH = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
let imp = { step: 0, busy: false, err: null, opt: { mode: "create_update", stock: "ignore", blanks: "keep", createCategories: true }, filter: "all" };

function impParseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const first = text.slice(0, text.search(/\r?\n|$/)); const delim = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ";" : ",";
  const rows = []; let row = [], f = "", q = false;
  for (let i = 0; i < text.length; i++) { const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"' && f === "") q = true; else if (c === delim) { row.push(f); f = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(f); rows.push(row); row = []; f = ""; } else f += c; }
  if (q) throw new AppErr("FILE", "The CSV file has an unclosed quote. Export it again.");
  if (f !== "" || row.length) { row.push(f); rows.push(row); }
  return rows.map((r) => r.map((t) => ({ t, num: false })));
}
function impCell(v) {
  if (v == null) return { t: "", num: false };
  if (typeof v === "number") return { t: String(v), num: true };
  if (typeof v === "string") return { t: v, num: false };
  if (typeof v === "boolean") return { t: String(v), num: false };
  if (v instanceof Date) return { t: v.toISOString().slice(0, 10), num: false };
  if (v.richText) return { t: v.richText.map((r) => r.text).join(""), num: false };
  if (typeof v.text === "string") return { t: v.text, num: false };
  if ("result" in v) return impCell(v.result); // formulas: use the saved result, never evaluate
  return { t: "", num: false };
}
async function impRead(file) {
  if (file.size === 0) throw new AppErr("FILE", "The file is empty.");
  if (file.size > 5 * 1024 * 1024) throw new AppErr("FILE", "The file is larger than 5 MB. Split it into smaller files.");
  const buf = new Uint8Array(await file.arrayBuffer()); const zip = buf[0] === 0x50 && buf[1] === 0x4b; const name = file.name.toLowerCase();
  let grid;
  if (name.endsWith(".xlsx") || zip) {
    if (!zip) throw new AppErr("FILE", "This is not a valid .xlsx file. Save it from Excel as .xlsx or CSV.");
    if (!window.ExcelJS) throw new AppErr("FILE", "The Excel reader did not load. Check the connection, or save the file as CSV.");
    const wb = new ExcelJS.Workbook();
    try { await wb.xlsx.load(buf.buffer); } catch { throw new AppErr("FILE", "The spreadsheet could not be read. Save it again as .xlsx or CSV."); }
    const ws = wb.worksheets.find((w) => w.state === "visible" && w.name.toLowerCase() !== "instructions") || wb.worksheets[0];
    if (!ws) throw new AppErr("FILE", "The workbook has no worksheets.");
    grid = []; const width = ws.columnCount;
    ws.eachRow({ includeEmpty: true }, (r, n) => { const line = []; for (let c = 1; c <= width; c++) line.push(impCell(r.getCell(c).value)); grid[n - 1] = line; });
    for (let i = 0; i < grid.length; i++) grid[i] ||= [];
  } else if (name.endsWith(".csv") || name.endsWith(".txt")) grid = impParseCsv(new TextDecoder().decode(buf));
  else throw new AppErr("FILE", "Upload a .csv or .xlsx file.");
  let h = 0; while (h < grid.length && grid[h].every((c) => !c.t.trim())) h++;
  if (h >= grid.length) throw new AppErr("FILE", "The file has no header row.");
  const headers = grid[h].map((c, i) => c.t.trim() || `Column ${i + 1}`);
  const seen = new Set(); for (const x of headers) { if (seen.has(x.toLowerCase())) throw new AppErr("FILE", `Two columns are both called “${x}”. Rename one.`); seen.add(x.toLowerCase()); }
  const rows = [];
  for (let i = h + 1; i < grid.length; i++) { const line = grid[i]; if (!line || line.every((c) => !c?.t.trim())) continue;
    const cells = {}, numeric = []; headers.forEach((hd, j) => { cells[hd] = line[j]?.t ?? ""; if (line[j]?.num) numeric.push(hd); }); rows.push({ n: i + 1, cells, numeric }); }
  if (!rows.length) throw new AppErr("FILE", "The file has a header row but no data rows.");
  if (rows.length > MAX_IMPORT_ROWS) throw new AppErr("FILE", `This hosted version imports up to ${MAX_IMPORT_ROWS} rows at a time. Split the file.`);
  const mapping = {}; const used = new Set();
  for (const [k, l, , al] of IF) { const names = [k.replace(/_/g, " "), normH(l), ...al].map(normH); const hit = headers.find((x) => !used.has(x) && names.includes(normH(x))); if (hit) { mapping[k] = hit; used.add(hit); } }
  return { headers, rows, mapping };
}
const unguard = (s) => (/^'[=+\-@\t\r]/.test(s) ? s.slice(1) : s);
function impNormalise(r) {
  const errors = [], warnings = []; const m = imp.mapping; const o = imp.opt;
  const val = (k) => { const h = m[k]; if (!h) return undefined; const v = unguard(String(r.cells[h] ?? "")).trim(); return v === "" ? undefined : v; };
  const skuRaw = val("sku"); const sku = (skuRaw || "").toUpperCase();
  if (!skuRaw) errors.push("SKU is missing. Every row needs a SKU so it can be matched next time.");
  else if (!/^[A-Z0-9][A-Z0-9-]{1,31}$/.test(sku)) errors.push(`SKU “${skuRaw}” may only use letters, numbers and dashes (2–32 characters).`);
  const d = { sku, name: val("product_name"), category: val("category"), size: val("pot_size") };
  const hs = val("product_handle"); d.pk = (hs || d.name || "").trim().toLowerCase() || undefined;
  const bot = val("botanical_name"); d.botanical = bot !== undefined ? bot : m.botanical_name && o.blanks === "clear" ? "" : undefined;
  for (const [k, max] of [["name", 80], ["category", 40], ["size", 40]]) if (d[k] && d[k].length > max) errors.push(`${k === "name" ? "Product name" : k === "size" ? "Pot size" : "Category"} is longer than ${max} characters.`);
  const p = val("price"); if (p !== undefined) { const c = parseRand(p); if (c === null || c <= 0) errors.push(`Price “${p}” is not a valid amount above R0 (use e.g. 89.90).`); else d.price = c; }
  const qy = val("quantity"); if (qy !== undefined && o.stock !== "ignore") { if (!/^\d{1,6}$/.test(qy)) errors.push(`Quantity “${qy}” must be a whole number of 0 or more.`); else d.qty = +qy; }
  const lw = val("low_stock_threshold"); if (lw !== undefined) { if (!/^\d{1,5}$/.test(lw)) errors.push(`Low-stock warning “${lw}” must be a whole number.`); else d.low = +lw; }
  const st = val("status")?.toLowerCase(); if (st !== undefined) { if (["active", "published", "yes", "1", "true"].includes(st)) d.status = "active"; else if (["archived", "draft", "inactive", "no", "0", "false"].includes(st)) d.status = "archived"; else errors.push(`Status “${st}” must be active or archived.`); }
  const bc = val("barcode"); if (bc !== undefined) { if (!/^[\x21-\x7E]{1,48}$/.test(bc)) errors.push(`Barcode “${bc}” has spaces or unsupported characters.`); else d.barcode = bc; if (r.numeric.includes(m.barcode)) warnings.push(`Barcode ${bc} was stored as a number in the spreadsheet, so leading zeros may already be lost. Format the column as Text.`); }
  const sp = val("supplier_barcodes"); if (sp !== undefined) { const codes = [...new Set(sp.split("|").map((x) => x.trim()).filter(Boolean))]; const bad = codes.find((c) => !/^[\x21-\x7E]{1,48}$/.test(c)); if (bad) errors.push(`Supplier barcode “${bad}” has unsupported characters (separate several with |).`); else d.aliases = codes; }
  return { d, errors, warnings };
}
function impCodes(cat) { const own = new Map(); for (const v of Object.values(cat.variants)) { own.set(v.barcode, v.id); for (const a of v.aliases || []) own.set(a, v.id); } for (const c of cat.codesUsed || []) if (!own.has(c)) own.set(c, "retired"); return own; }
function impPlan(d, cat) {
  const errors = [], warnings = [], ch = {}; const o = imp.opt; const vs = Object.values(cat.variants); const own = impCodes(cat);
  const v = vs.find((x) => x.sku === d.sku);
  if (v) {
    if (o.mode === "create_only") return { action: "skip", errors, warnings: ["SKU already exists; “create new only” was chosen."], ch };
    if (d.pk && d.pk !== v.product) errors.push(`SKU ${d.sku} belongs to “${v.name}” (handle ${v.product}), but this row puts it under “${d.pk}”. Sizes cannot move between products.`);
    if (d.barcode && d.barcode !== v.barcode && own.get(d.barcode) !== v.id) errors.push(`Barcode cannot be changed for an existing size (it is ${v.barcode}). Add the new code under supplier barcodes instead.`);
    for (const c of d.aliases || []) if (own.has(c) && own.get(c) !== v.id) errors.push(`Supplier barcode ${c} is already registered to another item. Codes are never reused.`);
    if (d.size && d.size !== v.size && vs.some((x) => x.product === v.product && x.id !== v.id && x.size.toLowerCase() === d.size.toLowerCase())) errors.push(`“${v.name}” already has a size “${d.size}”.`);
    const cmp = (k, a, b) => { if (b !== undefined && b !== a) ch[k] = [a, b]; };
    cmp("name", v.name, d.name); cmp("botanical", v.botanical || "", d.botanical); cmp("category", v.category, d.category); cmp("size", v.size, d.size);
    cmp("price", v.price, d.price); cmp("low", v.low, d.low); cmp("status", v.archived ? "archived" : "active", d.status);
    const add = (d.aliases || []).filter((c) => own.get(c) !== v.id); if (add.length) ch.aliases = [null, add];
    if (d.qty !== undefined) { const cur = (imp.stockNow?.[v.id]) ?? onHand(v.id); if (o.stock === "set" && d.qty !== cur) ch.stock = [cur, d.qty]; if (o.stock === "add" && d.qty > 0) ch.stock = [cur, cur + d.qty]; }
    return { action: Object.keys(ch).length ? "update" : "unchanged", errors, warnings, ch, v };
  }
  if (o.mode === "update_only") return { action: "skip", errors, warnings: ["SKU not found; “update existing only” was chosen."], ch };
  const exists = vs.find((x) => x.product === d.pk);
  if (!d.size) errors.push("Pot / pack size is required to create a new item.");
  if (d.price === undefined) errors.push("Selling price is required to create a new item.");
  if (!exists) { if (!d.name) errors.push("Product name is required to create a new plant."); if (!d.category) errors.push("Category is required to create a new plant."); }
  if (exists && d.size && vs.some((x) => x.product === d.pk && x.size.toLowerCase() === d.size.toLowerCase())) errors.push(`This plant already has a size “${d.size}”. Use its SKU to update it.`);
  for (const c of [d.barcode, ...(d.aliases || [])].filter(Boolean)) if (own.has(c)) errors.push(`Barcode ${c} is already registered to another item. Codes are never reused.`);
  if (d.category && !(cat.categories || []).includes(d.category) && !o.createCategories) errors.push(`Category “${d.category}” does not exist.`);
  if (d.qty > 0 && o.stock !== "ignore") ch.stock = [0, d.qty];
  return { action: "create", errors, warnings, ch };
}
function impEvaluate(rows) {
  const cat = S.catalog || { variants: {}, categories: [] };
  const norm = rows.map((r) => ({ r, ...impNormalise(r) }));
  const bySku = {}, byCode = {}, bySize = {}, first = {};
  for (const x of norm) { const d = x.d; if (d.sku) (bySku[d.sku] ||= []).push(x.r.n); for (const c of [d.barcode, ...(d.aliases || [])].filter(Boolean)) (byCode[c] ||= new Set()).add(d.sku); if (d.pk && d.size) (bySize[d.pk + "\u0000" + d.size.toLowerCase()] ||= new Set()).add(d.sku); }
  return norm.map((x) => {
    const d = x.d, errors = [...x.errors], warnings = [...x.warnings];
    const dup = (bySku[d.sku] || []).filter((n) => n !== x.r.n); if (d.sku && dup.length) errors.push(`SKU ${d.sku} also appears on row ${dup.join(", ")}. Each SKU may appear once.`);
    for (const c of [d.barcode, ...(d.aliases || [])].filter(Boolean)) if (byCode[c].size > 1) errors.push(`Barcode ${c} is used by more than one SKU in this file.`);
    if (d.pk && d.size && bySize[d.pk + "\u0000" + d.size.toLowerCase()].size > 1) errors.push(`Size “${d.size}” appears twice for the same product with different SKUs.`);
    if (d.pk) { const f = first[d.pk]; if (!f) first[d.pk] = { cat: d.category, n: x.r.n }; else if (d.category && f.cat && d.category !== f.cat) errors.push(`Category “${d.category}” differs from row ${f.n} (“${f.cat}”) for the same product.`); }
    let plan = { action: "skip", errors: [], warnings: [], ch: {} };
    if (!errors.length) plan = impPlan(d, cat);
    errors.push(...plan.errors); warnings.push(...plan.warnings);
    return { n: x.r.n, d, status: errors.length ? "failed" : plan.action === "skip" ? "skipped" : "pending", action: plan.action, msg: errors.join(" "), warnings, ch: plan.ch };
  });
}
async function impApply(list) {
  const short = imp.jobId.slice(0, 8).toUpperCase();
  for (let i = 0; i < list.length; i += 20) {
    const batch = list.slice(i, i + 20).filter((e) => e.status === "pending");
    if (!batch.length) continue;
    await withLock(async () => {
      const d0 = today();
      const [cat0, stock, day] = await Promise.all([get(DOCS.catalog, null), get(DOCS.stock, { levels: {} }), getDay(d0)]);
      const cat = cat0 || { variants: {}, categories: [], nextCode: 1, nextId: 1, codesUsed: [] };
      imp.stockNow = stock.levels;
      for (const e of batch) {
        const d = e.d; const plan = impPlan(d, cat);
        if (plan.errors.length) { e.status = "failed"; e.msg = plan.errors.join(" "); continue; }
        if (plan.action === "skip") { e.status = "skipped"; e.warnings = plan.warnings; continue; }
        let v = plan.v;
        if (!v) {
          if (Object.keys(cat.variants).length >= MAX_SIZES) { e.status = "failed"; e.msg = `This hosted version holds up to ${MAX_SIZES} sizes.`; continue; }
          const own = impCodes(cat); let code = d.barcode, n = cat.nextCode || 1;
          if (!code) { do { code = "21" + String(n++).padStart(6, "0"); } while (own.has(code)); cat.nextCode = n; }
          const existing = Object.values(cat.variants).find((x) => x.product === d.pk);
          const id = "v" + (cat.nextId || 1); cat.nextId = (cat.nextId || 1) + 1;
          v = cat.variants[id] = { id, product: d.pk, name: d.name || existing.name, botanical: d.botanical ?? existing?.botanical ?? "", category: d.category || existing.category, size: d.size, sku: d.sku, barcode: code, aliases: [], price: d.price, low: d.low ?? 3, archived: d.status === "archived", relabel: false, createdAt: new Date().toISOString(), importedBy: S.me?.id || null };
          cat.codesUsed = [...(cat.codesUsed || []), code];
        } else {
          const nameChanged = d.name !== undefined && d.name !== v.name;
          for (const x of Object.values(cat.variants)) if (x.product === v.product) { if (d.name !== undefined) x.name = d.name; if (d.botanical !== undefined) x.botanical = d.botanical; if (d.category !== undefined) x.category = d.category; if (nameChanged && !x.archived) x.relabel = true; }
          if (d.price !== undefined && d.price !== v.price) { v.history = [...(v.history || []), { at: new Date().toISOString(), from: v.price, to: d.price, by: S.me?.id || null, source: "import" }]; v.oldPrice = v.price; v.price = d.price; v.relabel = true; }
          if (d.size !== undefined && d.size !== v.size) { v.size = d.size; v.relabel = true; }
          if (d.low !== undefined) v.low = d.low;
          if (d.status) v.archived = d.status === "archived";
        }
        for (const c of d.aliases || []) if (!impCodes(cat).has(c)) { v.aliases = [...(v.aliases || []), c]; cat.codesUsed = [...(cat.codesUsed || []), c]; }
        if (d.category && !cat.categories.includes(d.category)) cat.categories.push(d.category);
        const ref = `IMP-${short}-${e.n}`;
        if (d.qty !== undefined && imp.opt.stock !== "ignore" && !day.movements.some((m) => m.ref === ref)) {
          const cur = stock.levels[v.id] ?? 0; const delta = imp.opt.stock === "set" ? d.qty - cur : d.qty;
          if (delta !== 0) { stock.levels[v.id] = cur + delta; day.movements.push(mv(v.id, delta, imp.opt.stock === "set" ? "count_correction" : "receive", ref, imp.opt.stock === "set" ? "Import: stock count" : "Import: stock received", stock.levels[v.id])); }
        }
        e.status = "ok"; e.action = plan.action; e.ch = plan.ch; e.vid = v.id;
      }
      // Record first, then stock: a row's stock change is matched by its unique reference on retry.
      await S.db.doc(DOCS.catalog).set(cat); await dayRef(d0).set(day); await S.db.doc(DOCS.stock).set(stock);
    });
    imp.done = Math.min(list.length, i + 20); render();
  }
}
async function impSaveJob() {
  const ev = imp.evals; const summary = { file: imp.file, at: new Date().toISOString(), by: S.me?.id || null, options: imp.opt,
    counts: { ok: ev.filter((e) => e.status === "ok").length, failed: ev.filter((e) => e.status === "failed").length, skipped: ev.filter((e) => e.status === "skipped").length },
    rows: ev.slice(0, 1500).map((e) => ({ n: e.n, sku: e.d.sku, status: e.status, action: e.action, msg: e.msg.slice(0, 300) })) };
  try { await S.db.doc(`imports/${imp.jobId}`).set(summary); } catch {}
}
function impStart(fileObj) {
  imp = { ...imp, step: 0, busy: true, err: null };
  render();
  impRead(fileObj).then((r) => { imp = { ...imp, ...r, file: fileObj.name, step: 1, busy: false, jobId: uuid(), evals: null, done: 0 }; render(); })
    .catch((e) => { imp.busy = false; imp.err = e instanceof AppErr ? e.message : "The file could not be read."; render(); });
}
const impDesc = (ch) => Object.entries(ch || {}).map(([k, [a, b]]) => k === "aliases" ? `adds barcodes ${b.join(", ")}` : `${k} ${k === "price" ? rand(a) : a ?? "—"} → ${k === "price" ? rand(b) : b}`).join(" · ");
function viewData() {
  const STEPS = ["Upload", "Map columns", "Check & preview", "Confirm", "Progress", "Results"];
  const ev = imp.evals || []; const cnt = (f) => ev.filter(f).length;
  const nNew = cnt((e) => e.status !== "failed" && e.status !== "skipped" && e.action === "create"), nUpd = cnt((e) => e.status !== "failed" && e.status !== "skipped" && e.action === "update"),
    nSame = cnt((e) => e.status !== "failed" && e.status !== "skipped" && e.action === "unchanged"), nSkip = cnt((e) => e.status === "skipped"), nFail = cnt((e) => e.status === "failed"), nPend = cnt((e) => e.status === "pending");
  const newPlants = new Set(ev.filter((e) => e.action === "create" && e.status !== "failed" && !Object.values(S.catalog?.variants || {}).some((v) => v.product === e.d.pk && !(e.vid === v.id))).map((e) => e.d.pk)).size;
  const step = imp.step;
  const shown = ev.filter((e) => imp.filter === "all" || (imp.filter === "failed" ? e.status === "failed" : imp.filter === "skipped" ? e.status === "skipped" : e.status !== "failed" && e.status !== "skipped" && e.action === imp.filter));
  const tile = (l, v) => `<div class="card"><p class="small muted">${l}</p><p class="tab" style="font-size:1.5rem;font-weight:600">${v}</p></div>`;
  const badge = (e) => e.status === "failed" ? `<span class="pill danger">Problem</span>` : e.status === "skipped" ? `<span class="pill grey">Skipped</span>` : e.status === "ok" ? `<span class="pill green">${e.action === "create" ? "Created" : e.action === "update" ? "Updated" : "No change"}</span>` : `<span class="pill ${e.action === "create" ? "green" : e.action === "update" ? "warn" : "grey"}">${e.action === "create" ? "New" : e.action === "update" ? "Update" : "No change"}</span>`;
  const table = () => `<div class="tablewrap"><div class="row" style="padding:8px">${[["all", "All"], ["create", "New"], ["update", "Updates"], ["unchanged", "No change"], ["skipped", "Skipped"], ["failed", "Problems"]].map(([k, l]) => `<button class="btn ${imp.filter === k ? "primary" : "ghost"}" data-impfilter="${k}">${l}</button>`).join("")}</div>
    <div style="max-height:440px;overflow:auto;position:relative"><table><thead><tr><th>Row</th><th>SKU</th><th>Plant · size</th><th>Result</th><th>Details</th><th><span class="sr">Actions</span></th></tr></thead><tbody>
    ${shown.slice(0, 400).map((e) => `<tr ${e.status === "failed" ? 'style="background:#fdecea"' : ""}><td class="tab">${e.n}</td><td class="small">${esc(e.d.sku || "—")}</td><td>${esc(e.d.name || "(existing)")}${e.d.size ? ` <span class="muted">· ${esc(e.d.size)}</span>` : ""}</td><td>${badge(e)}</td>
      <td class="small">${e.msg ? `<span style="color:var(--danger)">${esc(e.msg)}</span><br>` : ""}${e.status !== "failed" ? esc(impDesc(e.ch)) : ""}${e.warnings.map((w) => `<br><span style="color:var(--warn)">${esc(w)}</span>`).join("")}</td>
      <td>${e.status === "failed" ? `<button class="btn" data-impfix="${e.n}">Correct</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="6" class="muted">No rows in this view.</td></tr>`}</tbody></table></div></div>`;
  return `<div class="page"><div><h1>Import/Export</h1><p class="muted small">Add or update many plants at once from a spreadsheet, or export your products to edit them in Excel.</p></div>
  <ol class="steps" aria-label="Import steps">${STEPS.map((s, i) => `<li class="${i < step ? "done" : ""}" ${i === step ? 'aria-current="step"' : ""}><strong class="tab">${i < step ? "✓" : i + 1}</strong> ${s}</li>`).join("")}</ol>
  ${imp.err ? `<div class="alert error" role="alert">${esc(imp.err)}</div>` : ""}
  ${step === 0 ? `<div class="grid2"><label class="drop" id="impDrop" for="impFile"><strong style="font-size:1.1rem">${imp.busy ? "Reading the file…" : "Choose a CSV or Excel file"}</strong><span class="small muted">or drag it here · .csv or .xlsx · up to ${MAX_IMPORT_ROWS} rows</span><input id="impFile" type="file" accept=".csv,.xlsx" class="sr"></label>
    <div class="card stack"><h2>Start from the template</h2><p class="small muted">One row per pot size. Rows with the same product handle are sizes of one plant. Rows are matched by SKU, so importing the same file twice never creates duplicates.</p>
    <div class="row"><button class="btn" data-act="tplX">Template (.xlsx)</button><button class="btn" data-act="tplC">Template (.csv)</button></div>
    <ul class="small muted" style="margin:0;padding-left:18px"><li>Required on every row: <strong>SKU</strong>. New items also need name, category, pot size and price.</li><li>Format barcode columns as <strong>Text</strong> in Excel so leading zeros stay.</li><li>Nothing changes until you check the preview and confirm.</li></ul></div></div>` : ""}
  ${step === 1 ? `<section class="card stack"><h2>Match your columns · ${esc(imp.file)}</h2><p class="small muted">${imp.rows.length} data rows. Recognised columns are already matched.</p>
    <div class="fields">${IF.map(([k, l, req]) => { const s = imp.mapping[k] ? imp.rows.slice(0, 2).map((r) => r.cells[imp.mapping[k]]).filter(Boolean).join(" · ") : ""; return `<label class="f" for="map-${k}">${l} ${req === "always" ? '<span class="pill danger">Required</span>' : req === "new" ? '<span class="pill warn">New items</span>' : ""}
      <select id="map-${k}" class="i" data-map="${k}"><option value="">— Not in this file —</option>${imp.headers.map((h) => `<option ${imp.mapping[k] === h ? "selected" : ""}>${esc(h)}</option>`).join("")}</select><span class="small muted">${s ? "e.g. " + esc(s.slice(0, 50)) : "&nbsp;"}</span></label>`; }).join("")}</div></section>
    <section class="card grid2">
      <fieldset style="border:0;padding:0"><legend style="font-weight:600">What may the import do?</legend>${[["create_update", "Create new items and update existing ones"], ["create_only", "Create new items only"], ["update_only", "Update existing items only"]].map(([v, l]) => `<label class="row small" style="min-height:44px;flex-wrap:nowrap"><input type="radio" name="impmode" value="${v}" ${imp.opt.mode === v ? "checked" : ""} style="width:20px;height:20px;accent-color:var(--forest)">${l}</label>`).join("")}</fieldset>
      <fieldset style="border:0;padding:0"><legend style="font-weight:600">How should quantities be used?</legend>${[["ignore", "Don't change stock"], ["set", "Replace stock with the quantity (a stock count)"], ["add", "Add the quantity to stock (stock received)"]].map(([v, l]) => `<label class="row small" style="min-height:44px;flex-wrap:nowrap"><input type="radio" name="impstock" value="${v}" ${imp.opt.stock === v ? "checked" : ""} style="width:20px;height:20px;accent-color:var(--forest)">${l}</label>`).join("")}</fieldset>
      <fieldset style="border:0;padding:0"><legend style="font-weight:600">Blank cells for existing items</legend>${[["keep", "Keep the current value"], ["clear", "Clear the botanical name"]].map(([v, l]) => `<label class="row small" style="min-height:44px;flex-wrap:nowrap"><input type="radio" name="impblank" value="${v}" ${imp.opt.blanks === v ? "checked" : ""} style="width:20px;height:20px;accent-color:var(--forest)">${l}</label>`).join("")}</fieldset>
      <fieldset style="border:0;padding:0"><legend style="font-weight:600">Extras</legend><label class="row small" style="min-height:44px;flex-wrap:nowrap"><input type="checkbox" id="impcat" ${imp.opt.createCategories ? "checked" : ""} style="width:20px;height:20px;accent-color:var(--forest)">Create missing categories</label></fieldset></section>
    <div class="row"><button class="btn primary lg" data-act="impCheck" ${imp.mapping.sku ? "" : "disabled"}>Check file</button><button class="btn ghost lg" data-act="impReset">Choose another file</button>${imp.mapping.sku ? "" : '<span class="small" style="color:var(--danger)">Match a column to SKU to continue.</span>'}</div>` : ""}
  ${step === 2 || step === 5 ? `${step === 5 ? `<div class="alert ${nFail ? "warn" : "ok"}"><strong>${nFail ? "Import finished with problems" : "Import complete"}</strong> — ${cnt((e) => e.status === "ok")} imported${nFail ? `, ${nFail} need correcting` : ""}${nSkip ? `, ${nSkip} skipped` : ""}.</div>` : ""}
    <div class="tiles">${tile(step === 5 ? "Created" : "New sizes", step === 5 ? cnt((e) => e.status === "ok" && e.action === "create") : `${nNew} <span class="small muted" style="font-weight:400">(${newPlants} new plant${newPlants === 1 ? "" : "s"})</span>`)}${tile(step === 5 ? "Updated" : "Updates", step === 5 ? cnt((e) => e.status === "ok" && e.action === "update") : nUpd)}${tile("No change", nSame)}${tile("Skipped", nSkip)}${tile("Problems", nFail)}</div>
    ${table()}
    ${step === 2 ? `<section class="card stack"><h2>Confirm the import</h2><p>${nPend} row${nPend === 1 ? "" : "s"} will be imported${imp.opt.stock !== "ignore" ? `; stock will be ${imp.opt.stock === "set" ? "replaced with the counted quantities" : "increased by the received quantities"}` : "; stock will not change"}.</p>
      ${nFail ? `<label class="row small" style="flex-wrap:nowrap;min-height:44px"><input type="checkbox" id="impAck" ${imp.ack ? "checked" : ""} style="width:20px;height:20px;accent-color:var(--forest)">Import the ${nPend} valid rows now. The ${nFail} row${nFail === 1 ? "" : "s"} with problems will not be imported — you can correct them afterwards.</label>` : ""}
      <div class="row"><button class="btn primary lg" data-act="impGo" ${!nPend || (nFail && !imp.ack) ? "disabled" : ""}>Import ${nPend} row${nPend === 1 ? "" : "s"}</button><button class="btn lg" data-act="impBack">Back to column matching</button><button class="btn ghost lg" data-act="impReset">Cancel</button></div></section>`
    : `<div class="row"><button class="btn" data-act="impReport">Download results (.csv)</button><button class="btn ghost" data-act="impReset">Start a new import</button></div>`}` : ""}
  ${step === 4 ? `<section class="card stack" aria-live="polite"><h2>Importing ${esc(imp.file)}…</h2><div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round((imp.done / Math.max(1, ev.length)) * 100)}" aria-label="Import progress"><div style="width:${Math.round((imp.done / Math.max(1, ev.length)) * 100)}%"></div></div><p class="small tab">${imp.done} of ${ev.length} rows processed. Keep this page open until it finishes.</p></section>` : ""}
  <section class="card stack"><h2>Export products</h2><p class="small muted">Every size with its SKU, barcodes, price, stock and status — in the same format as the import template, so you can edit it in Excel and import it back. Barcodes stay as text so leading zeros are kept.</p>
    <div class="row"><button class="btn primary" data-act="expX">Export Excel (.xlsx)</button><button class="btn" data-act="expC">Export CSV</button></div>
    <p class="small muted">CSV cells that start with = + - or @ get a leading apostrophe so spreadsheets never run them as formulas; the import removes it again.</p></section></div>`;
}
const EXP_HEAD = IF.map(([k]) => k);
function expRows() {
  return Object.values(S.catalog?.variants || {}).sort((a, b) => a.name.localeCompare(b.name) || a.size.localeCompare(b.size))
    .map((v) => [v.product, v.name, v.botanical || "", v.category, v.size, v.sku, v.barcode, (v.aliases || []).join("|"), centsIn(v.price), onHand(v.id), v.low, v.archived ? "archived" : "active"]);
}
const csvOf = (head, rows) => "﻿" + [head, ...rows].map((r) => r.map((x) => { let s = x == null ? "" : String(x); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\r\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(",")).join("\r\n") + "\r\n";
async function xlsxOf(sheets) {
  if (!window.ExcelJS) throw new AppErr("FILE", "The Excel writer did not load. Use CSV instead.");
  const wb = new ExcelJS.Workbook();
  for (const s of sheets) { const ws = wb.addWorksheet(s.name, { views: [{ state: "frozen", ySplit: 1 }] }); ws.addRow(s.head).font = { bold: true };
    for (const r of s.rows) { const row = ws.addRow(r.map((x, i) => (x === "" || x == null ? null : s.num?.includes(s.head[i]) && typeof x === "number" ? x : String(x)))); row.eachCell((c, col) => { if (!s.num?.includes(s.head[col - 1])) c.numFmt = "@"; }); }
    s.head.forEach((h, i) => { ws.getColumn(i + 1).width = Math.max(12, h.length + 4); }); }
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
async function saveFile(name, data, type) {
  downloads ||= await window.claude?.use?.("downloads");
  if (!downloads) { toast("Saving files isn't available in this view. Open the page in Claude."); return; }
  try { await downloads.save({ filename: name, data: new Blob([data], { type }) }); } catch { toast("The file was not saved."); }
}
const XT = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
async function impAction(act) {
  try {
    if (act === "tplX" || act === "tplC") {
      const ex = [["example-lavender", "EXAMPLE Lavender", "Lavandula angustifolia", "Herbs & lavender", "15 cm pot", "EX-LAV-15", "", "", "89.90", "12", "3", "active"], ["example-lavender", "EXAMPLE Lavender", "Lavandula angustifolia", "Herbs & lavender", "20 cm pot", "EX-LAV-20", "", "0060012345678", "149.90", "6", "3", "active"]];
      if (act === "tplC") return saveFile("product-import-template.csv", csvOf(EXP_HEAD, ex), "text/csv");
      return saveFile("product-import-template.xlsx", await xlsxOf([{ name: "Products", head: EXP_HEAD, rows: ex }, { name: "Instructions", head: ["column", "meaning"], rows: [...IF.map(([k, l, r]) => [k, `${l}${r === "always" ? " (required on every row)" : r === "new" ? " (required for new items)" : ""}`]), ["", "One row per pot size. Same product_handle = sizes of one plant. Delete the EXAMPLE rows before importing."]] }]), XT);
    }
    if (act === "expC") return saveFile(`products-${today()}.csv`, csvOf(EXP_HEAD, expRows()), "text/csv");
    if (act === "expX") return saveFile(`products-${today()}.xlsx`, await xlsxOf([{ name: "Products", head: EXP_HEAD, rows: expRows(), num: ["quantity", "low_stock_threshold"] }]), XT);
    if (act === "impReset") { imp = { step: 0, busy: false, err: null, opt: imp.opt, filter: "all" }; return render(); }
    if (act === "impBack") { imp.step = 1; return render(); }
    if (act === "impCheck") { imp.stockNow = null; imp.evals = impEvaluate(imp.rows); imp.step = 2; imp.ack = false; imp.err = null; return render(); }
    if (act === "impGo") { imp.step = 4; imp.done = 0; render(); await impApply(imp.evals); await impSaveJob(); imp.step = 5; return render(); }
    if (act === "impReport") return saveFile(`import-results-${imp.file.replace(/\.[^.]+$/, "")}.csv`, csvOf(["row", "sku", "product_name", "pot_size", "result", "action", "changes", "message", "warnings"],
      imp.evals.map((e) => [e.n, e.d.sku, e.d.name || "", e.d.size || "", { ok: "imported", failed: "failed", skipped: "skipped", pending: "not processed" }[e.status], e.action, impDesc(e.ch), e.msg, e.warnings.join(" ")])), "text/csv");
  } catch (e) { imp.err = e instanceof AppErr ? e.message : "Something went wrong. Nothing more was changed — check the results and try again."; if (imp.step === 4) imp.step = 5; render(); }
}
function impFix(n) {
  const r = imp.rows.find((x) => x.n === n); const e = imp.evals.find((x) => x.n === n);
  dialog(`Correct row ${n}`, `<div class="alert error">${esc(e.msg)}</div><form id="impFixForm" data-n="${n}" class="stack" style="margin-top:10px"><div class="fields">${IF.filter(([k]) => imp.mapping[k]).map(([k, l]) => `<label class="f" for="fix-${k}">${l}<input id="fix-${k}" class="i" data-fix="${esc(imp.mapping[k])}" value="${esc(r.cells[imp.mapping[k]] ?? "")}"></label>`).join("")}</div>
    <p class="small muted">${imp.step === 2 ? "Saving re-checks this row; if it passes it is included when you confirm." : "Saving re-checks this row and, if it passes, imports it straight away."}</p><button class="btn primary">Save and re-check</button></form>`, { wide: true });
}
async function impFixSave(form) {
  const n = +form.dataset.n; const r = imp.rows.find((x) => x.n === n);
  for (const inp of form.querySelectorAll("[data-fix]")) r.cells[inp.dataset.fix] = inp.value;
  const others = imp.evals.filter((x) => x.n !== n && x.status !== "failed").map((x) => imp.rows.find((y) => y.n === x.n));
  const fresh = impEvaluate([...others, r]).find((x) => x.n === n);
  const i = imp.evals.findIndex((x) => x.n === n); imp.evals[i] = fresh; closeDialog();
  if (imp.step === 5 && fresh.status === "pending") { imp.step = 4; imp.done = 0; render(); try { await impApply([fresh]); await impSaveJob(); } catch {} imp.step = 5; }
  render();
}
