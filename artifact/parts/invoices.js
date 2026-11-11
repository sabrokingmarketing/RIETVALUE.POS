// ---------------------------------------------------------------- INVOICES
/** The nursery's own logo, uploaded in Settings (stored as a PNG data URL). Nothing is drawn when there is none. */
const shopLogo = () => (typeof S !== "undefined" && S.logo?.dataUrl && /^data:image\/png;base64,/.test(S.logo.dataUrl) ? S.logo.dataUrl : null);
const PAID_M = { eft: "EFT / bank transfer", cash: "Cash", card: "Card", other: "Other" };
const sDate = (ymd) => { if (!ymd) return "—"; const [y, m, d] = ymd.slice(0, 10).split("-").map(Number); return new Intl.DateTimeFormat("en-ZA", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(new Date(Date.UTC(y, m - 1, d))); };
const saYmd = (iso) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(iso));
const isMail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(s || "").trim());
const invTitle = (inv) => (inv.vatReg ? "Tax invoice" : "Invoice");
function invBadge(inv) {
  if (inv.status === "paid") return ["Paid", "green"];
  if (inv.status === "void") return ["Void", "danger"];
  if (inv.status === "draft") return ["Draft", "grey"];
  if (inv.due && inv.due < today()) return ["Overdue", "danger"];
  return ["Awaiting payment", "warn"];
}
const custKey = (b) => (b.email ? b.email.toLowerCase() : `name:${b.name.toLowerCase()}`);
function invBiz() {
  const s = S.settings || {};
  return { name: s.businessName || "", legal: s.legalName || "", vatNo: s.vatRegistered ? s.vatNumber || "" : "", address: s.address || "", phone: s.phone || "", email: s.email || "", thanks: s.invThanks || "Thank you for your business!" };
}
function invSummary(inv) { return { id: inv.id, no: inv.no, status: inv.status, source: inv.source, name: inv.bill.name, company: inv.bill.company, email: inv.bill.email, issue: inv.issue, due: inv.due, total: inv.total, createdAt: inv.createdAt, sent: (inv.emails || []).length > 0, paidAt: inv.paidAt || null }; }

/** Writes an invoice and its index entry under the shop lock. Issuing assigns the next gap-free number. */
async function putInvoice(inv, { issue = false } = {}) {
  return withLock(async () => {
    const idx = await get(DOCS.invoices, { items: {}, customers: {} });
    if (issue && !inv.no) {
      const counters = await get(DOCS.counters, { sale: 0, ret: 0, delivery: 0 });
      counters.invoice = (counters.invoice || 0) + 1; await S.db.doc(DOCS.counters).set(counters);
      inv.no = `INV-${String(counters.invoice).padStart(6, "0")}`; inv.issuedAt = new Date().toISOString();
      if (inv.status === "draft") inv.status = "issued";
    }
    inv.updatedAt = new Date().toISOString();
    await S.db.doc(`invoices/${inv.id}`).set(inv);
    idx.items[inv.id] = invSummary(inv);
    if (inv.bill.name) idx.customers[custKey(inv.bill)] = { ...inv.bill, at: inv.updatedAt };
    await S.db.doc(DOCS.invoices).set(idx);
    return inv;
  });
}
async function loadInvoice(id) { const s = await S.db.doc(`invoices/${id}`).get(); return s.exists ? structuredClone(s.data()) : null; }

/** A paid invoice for a completed till sale (one per sale; repeating re-uses it). */
async function invoiceFromSale(sale, date, bill) {
  const existing = Object.values(S.invoices?.items || {}).find((x) => x.source === "sale" && x.saleKey === sale.key);
  if (existing) return loadInvoice(existing.id);
  const already = await withLock(async () => { const idx = await get(DOCS.invoices, { items: {} }); return Object.values(idx.items).find((x) => x.saleKey === sale.key); });
  if (already) return loadInvoice(already.id);
  const inv = {
    id: uuid(), no: null, source: "sale", saleKey: sale.key, saleDate: date, receiptNo: sale.no, status: "paid",
    bill: { name: bill.name || bill.email, company: bill.company || "", email: bill.email.trim().toLowerCase(), phone: "", address: bill.address || "", vat: bill.vat || "" },
    issue: date, due: date, ref: `Receipt ${sale.no}`, notes: "", pay: "",
    lines: sale.lines.map((l) => ({ desc: l.desc, sku: l.sku, qty: l.qty, unit: l.unit, total: l.total, vat: l.vat, vid: l.id })),
    total: sale.total, vat: sale.vat, vatReg: sale.vatRegistered, vatBp: sale.biz.vatBp,
    biz: { name: sale.biz.name, legal: sale.biz.legal, vatNo: sale.biz.vatNo, address: sale.biz.address, phone: sale.biz.phone, email: S.settings?.email || "", thanks: S.settings?.invThanks || "Thank you for your business!" },
    paidAt: sale.at, paidMethod: sale.payment.method, paidRef: sale.payment.ref || "", createdAt: new Date().toISOString(), by: S.me?.id || null, emails: [],
  };
  const r = await putInvoice(inv, { issue: true });
  return r;
}

/** Opens the customer's e-mail app with the invoice details filled in (the PDF is saved first to attach). */
function mailtoFor(inv) {
  const paid = inv.status === "paid";
  const first = inv.bill.name && !inv.bill.name.includes("@") ? inv.bill.name.split(/\s+/)[0] : "";
  const body = [`Hi${first ? " " + first : ""},`, "",
    paid ? `Thank you for your purchase at ${inv.biz.name}. Your ${invTitle(inv).toLowerCase()} ${inv.no} for ${rand(inv.total)} is attached — it is paid in full.`
      : `Please find attached ${invTitle(inv).toLowerCase()} ${inv.no} from ${inv.biz.name} for ${rand(inv.total)}${inv.due && inv.due !== inv.issue ? `, due on ${sDate(inv.due)}` : ""}.`,
    ...(!paid && inv.pay ? ["", "How to pay:", inv.pay] : []), "", inv.biz.thanks, "", inv.biz.name, ...(inv.biz.phone ? [`Tel ${inv.biz.phone}`] : [])].join("\n");
  return `mailto:${encodeURIComponent(inv.bill.email)}?subject=${encodeURIComponent(`${invTitle(inv)} ${inv.no} from ${inv.biz.name}`)}&body=${encodeURIComponent(body)}`;
}
async function sendInvoice(inv) {
  await invoicePdf(inv);
  inv.emails = [...(inv.emails || []), { to: inv.bill.email, at: new Date().toISOString(), by: S.me?.id || null }];
  putInvoice(inv).catch(() => {});
  sendInvoice.text = decodeURIComponent(mailtoFor(inv).split("&body=")[1]);
  dialog("E-mail the invoice", `<ol class="stack small" style="margin:0;padding-left:20px"><li><strong>The PDF is saved</strong> as ${esc(`${inv.vatReg ? "Tax-invoice" : "Invoice"}-${inv.no}.pdf`)}.</li><li>Tap <strong>Open my e-mail app</strong> — the customer, subject and message are filled in.</li><li>Attach the PDF and press Send.</li></ol>
    <div class="alert ok small" style="margin-top:12px"><strong>To:</strong> ${esc(inv.bill.email)}<br><strong>Subject:</strong> ${esc(`${invTitle(inv)} ${inv.no} from ${inv.biz.name}`)}</div>`,
    { icon: "receipts", sub: `${esc(inv.no)} · ${rand(inv.total)}`, foot: `<button class="btn ghost" data-act="invCopyMail">Copy message</button><button class="btn" data-invpdf2="${inv.id}">Save PDF again</button><a class="btn primary" href="${esc(mailtoFor(inv))}" target="_blank" rel="noopener">✉ Open my e-mail app</a>` });
}
// ---- the document (HTML) ---------------------------------------------------
function invDocHtml(inv) {
  const b = inv.biz; const [bl, bt] = invBadge(inv); const paid = inv.status === "paid";
  const due = paid && inv.paidAt ? sDate(saYmd(inv.paidAt)) : inv.due && inv.due !== inv.issue ? sDate(inv.due) : "On receipt";
  const L = (t) => `<p class="ilbl">${t}</p>`;
  return `<article class="idoc">${inv.status === "void" || inv.status === "draft" ? `<span class="iwm ${inv.status}">${inv.status === "void" ? "VOID" : "DRAFT"}</span>` : ""}
  <div class="ibar"></div><div class="ipad">
  <header class="ihead"><div><h2 class="ititle">${invTitle(inv).toUpperCase()}</h2><p class="row small muted" style="margin-top:4px"><span class="tab">${esc(inv.no || "Number given when issued")}</span><span class="pill ${bt}">${bl}</span></p></div>
    <div class="ibrand">${shopLogo() ? `<img src="${shopLogo()}" alt="${esc(b.name)}" style="height:112px;max-width:240px;object-fit:contain">` : `<div style="text-align:right"><p style="font-weight:700;color:var(--forest);font-size:1.05rem">${esc(b.name)}</p>${b.legal && b.legal !== b.name ? `<p class="small muted">${esc(b.legal)}</p>` : ""}</div>`}</div></header>
  <div class="iband"><section>${L("Bill from")}<p><strong>${esc(b.name)}</strong></p>${b.address ? `<p class="muted pre">${esc(b.address)}</p>` : ""}${b.phone ? `<p class="muted">Tel ${esc(b.phone)}</p>` : ""}${b.email ? `<p class="muted">${esc(b.email)}</p>` : ""}${b.vatNo ? `<p>VAT no. ${esc(b.vatNo)}</p>` : ""}</section>
    <section>${L("Bill to")}<p><strong>${esc(inv.bill.name) || '<span class="muted">Customer name</span>'}</strong></p>${inv.bill.company ? `<p>${esc(inv.bill.company)}</p>` : ""}${inv.bill.address ? `<p class="muted pre">${esc(inv.bill.address)}</p>` : ""}${inv.bill.email ? `<p class="muted" style="word-break:break-all">${esc(inv.bill.email)}</p>` : ""}${inv.bill.phone ? `<p class="muted">Tel ${esc(inv.bill.phone)}</p>` : ""}${inv.bill.vat ? `<p>VAT no. ${esc(inv.bill.vat)}</p>` : ""}</section>
    <section class="idates"><div>${L("Issue date")}<p><strong>${sDate(inv.issue)}</strong></p></div><div>${L(paid ? "Paid on" : "Due date")}<p><strong>${due}</strong></p></div>${inv.ref ? `<div>${L("Reference")}<p><strong>${esc(inv.ref)}</strong></p></div>` : ""}</section></div>
  <div class="tablewrap" style="box-shadow:none;margin-top:22px"><table class="itable"><thead><tr><th>Description</th><th class="r">Price</th><th class="c">Qty</th><th class="r">Total</th></tr></thead><tbody>
    ${inv.lines.length ? inv.lines.map((l) => `<tr><td><strong style="font-weight:500">${esc(l.desc) || '<span class="muted">Description</span>'}</strong>${l.sku ? `<br><span class="small muted">${esc(l.sku)}</span>` : ""}</td><td class="r tab">${rand(l.unit)}</td><td class="c tab">${l.qty}</td><td class="r tab"><strong>${rand(l.total)}</strong></td></tr>`).join("") : `<tr><td colspan="4" class="muted" style="text-align:center;padding:20px">Line items appear here</td></tr>`}
  </tbody></table></div>
  <div class="ifoot"><div class="stack small" style="max-width:330px">${inv.pay ? `<div>${L("Payment information")}<p class="pre">${esc(inv.pay)}</p></div>` : ""}${inv.notes ? `<div>${L("Notes")}<p class="pre">${esc(inv.notes)}</p></div>` : ""}${!inv.pay && !inv.notes && inv.source === "sale" ? `<div>${L("Payment")}<p>Paid in full at the till (receipt ${esc(inv.receiptNo)}).</p></div>` : ""}</div>
    <dl class="itot">${inv.vatReg ? `<div><dt>Subtotal (excl. VAT)</dt><dd class="tab">${rand(inv.total - inv.vat)}</dd></div><div><dt>VAT ${inv.vatBp / 100}%</dt><dd class="tab">${rand(inv.vat)}</dd></div>` : `<div><dt>Subtotal</dt><dd class="tab">${rand(inv.total)}</dd></div>`}
      <div class="igrand ${paid ? "paid" : ""}"><dt>${paid ? "Total" : "Total due"}</dt><dd class="tab">${rand(inv.total)}</dd></div>
      ${paid ? `<p class="small" style="color:var(--forest);padding:6px 12px 0">Paid${inv.paidMethod ? ` · ${PAID_M[inv.paidMethod]}` : ""}${inv.paidAt ? ` · ${sDate(saYmd(inv.paidAt))}` : ""}</p><div class="ibal"><dt>Balance due</dt><dd class="tab">R0.00</dd></div>` : ""}</dl></div>
  ${inv.status === "void" && inv.voidReason ? `<p class="small" style="color:var(--danger);margin-top:16px;font-weight:600">Voided: ${esc(inv.voidReason)}</p>` : ""}
  </div><footer class="ifbar"><strong>${esc(b.thanks)}</strong><span>${[b.phone && `Tel ${esc(b.phone)}`, b.email && esc(b.email)].filter(Boolean).join(" · ")}</span></footer></article>`;
}

// ---- PDF (A4, pdf-lib) -------------------------------------------------------
async function invoicePdf(inv) {
  if (!window.PDFLib) return toast("The PDF tool did not load. Check the connection.");
  const { PDFDocument, StandardFonts, rgb, degrees } = PDFLib; const MM = 72 / 25.4; const W = 210, H = 297, MX = 16;
  const hx = (h) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
  const C = { ink: hx("#17211B"), muted: hx("#647067"), deep: hx("#365314"), line: hx("#E5E7EB"), soft: hx("#ECFCCB"), lime: hx("#A3E635"), white: rgb(1, 1, 1), mist: hx("#F7F9F6"), danger: hx("#B42318") };
  const doc = await PDFDocument.create(); const R = await doc.embedFont(StandardFonts.Helvetica); const B = await doc.embedFont(StandardFonts.HelveticaBold);
  doc.setTitle(`${invTitle(inv)} ${inv.no || "draft"} — ${inv.biz.name}`); doc.setCreator("Rietvalei POS");
  const clean = (t) => String(t ?? "").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[—–]/g, "-").replace(/[^\x20-\x7E\xA0-\xFF\n]/g, "?");
  let page; const pages = [];
  const text = (t, x, y, f, size, color = C.ink, align = "left") => { const s = clean(t); const w = f.widthOfTextAtSize(s, size); page.drawText(s, { x: align === "right" ? x * MM - w : align === "center" ? x * MM - w / 2 : x * MM, y: (H - y) * MM - size * 0.78, size, font: f, color }); };
  const rect = (x, y, w, h, color) => page.drawRectangle({ x: x * MM, y: (H - y - h) * MM, width: w * MM, height: h * MM, color });
  const hl = (y, x1 = MX, x2 = W - MX) => page.drawLine({ start: { x: x1 * MM, y: (H - y) * MM }, end: { x: x2 * MM, y: (H - y) * MM }, thickness: 0.6, color: C.line });
  const wrap = (t, f, size, maxMm) => { const out = []; for (const para of clean(t).split("\n")) { let cur = ""; for (const w of para.split(/\s+/).filter(Boolean)) { const n = cur ? cur + " " + w : w; if (f.widthOfTextAtSize(n, size) / MM <= maxMm) cur = n; else { if (cur) out.push(cur); cur = w; } } out.push(cur); } return out.filter((x, i, a) => x !== "" || i < a.length - 1); };
  const lbl = (t, x, y) => text(t.toUpperCase(), x, y, B, 6.6, C.muted);
  const title = invTitle(inv).toUpperCase(); const [badge] = invBadge(inv); const b = inv.biz;
  const newPage = async (first) => {
    page = doc.addPage([W * MM, H * MM]); pages.push(page); rect(0, 0, W, 3.2, C.deep); rect(0, 3.2, W, 1.2, C.lime);
    if (!first) { text(`${title}  ${inv.no || "DRAFT"}`, MX, 12, B, 9, C.muted); return 22; }
    text(title, MX, 15, B, 25, C.ink); text(`${inv.no || "DRAFT"}   ·   ${badge}`, MX, 27.5, R, 10.5, C.muted);
    const lg = shopLogo() ? await doc.embedPng(shopLogo()) : null;
    if (lg) { const sc = Math.min((44 * MM) / lg.width, (30 * MM) / lg.height); const w = lg.width * sc, h = lg.height * sc; page.drawImage(lg, { x: (W - MX) * MM - w, y: (H - 10) * MM - h, width: w, height: h }); }
    else { const nl = wrap(b.name, B, 12.5, 80).slice(0, 2); let ny = 17 + (nl.length === 1 ? 2.5 : 0); for (const l of nl) { text(l, W - MX, ny, B, 12.5, C.deep, "right"); ny += 6; } }
    return 44;
  };
  let y = await newPage(true);
  const colW = (W - 2 * MX) / 3;
  const from = [[b.name, B, C.ink], ...(b.address ? b.address.split("\n").map((l) => [l, R, C.muted]) : []), ...(b.phone ? [[`Tel ${b.phone}`, R, C.muted]] : []), ...(b.email ? [[b.email, R, C.muted]] : []), ...(b.vatNo ? [[`VAT no. ${b.vatNo}`, R, C.ink]] : [])];
  const to = [[inv.bill.name || "-", B, C.ink], ...(inv.bill.company ? [[inv.bill.company, R, C.ink]] : []), ...(inv.bill.address ? inv.bill.address.split("\n").map((l) => [l, R, C.muted]) : []), ...(inv.bill.email ? [[inv.bill.email, R, C.muted]] : []), ...(inv.bill.phone ? [[`Tel ${inv.bill.phone}`, R, C.muted]] : []), ...(inv.bill.vat ? [[`VAT no. ${inv.bill.vat}`, R, C.ink]] : [])];
  const wc = (ls) => ls.flatMap(([t, f, c]) => wrap(t, f, 8.6, colW - 9).map((w) => [w, f, c])).slice(0, 10);
  const fw = wc(from), tw = wc(to); const paid = inv.status === "paid";
  const dates = [["Issue date", sDate(inv.issue)], [paid ? "Paid on" : "Due date", paid && inv.paidAt ? sDate(saYmd(inv.paidAt)) : inv.due && inv.due !== inv.issue ? sDate(inv.due) : "On receipt"], ...(inv.ref ? [["Reference", inv.ref]] : [])];
  const bandH = Math.max(fw.length, tw.length, dates.length * 2.4) * 4.3 + 15;
  hl(y); hl(y + bandH); page.drawLine({ start: { x: (MX + colW) * MM, y: (H - y - 3) * MM }, end: { x: (MX + colW) * MM, y: (H - y - bandH + 3) * MM }, thickness: 0.6, color: C.line });
  page.drawLine({ start: { x: (MX + 2 * colW) * MM, y: (H - y - 3) * MM }, end: { x: (MX + 2 * colW) * MM, y: (H - y - bandH + 3) * MM }, thickness: 0.6, color: C.line });
  lbl("Bill from", MX, y + 5); lbl("Bill to", MX + colW + 5, y + 5);
  let yy = y + 11; for (const [t, f, c] of fw) { text(t, MX, yy, f, 8.6, c); yy += 4.3; }
  yy = y + 11; for (const [t, f, c] of tw) { text(t, MX + colW + 5, yy, f, 8.6, c); yy += 4.3; }
  yy = y + 5; for (const [k, v] of dates) { lbl(k, MX + 2 * colW + 5, yy); text(v, MX + 2 * colW + 5, yy + 4.4, B, 9, C.ink); yy += 10.4; }
  y += bandH + 9;
  const X = { d: MX + 4, p: W - MX - 62, q: W - MX - 34, t: W - MX - 4 };
  const head = () => { rect(MX, y, W - 2 * MX, 9, C.soft); text("DESCRIPTION", X.d, y + 3.2, B, 7, C.deep); text("PRICE", X.p, y + 3.2, B, 7, C.deep, "right"); text("QTY", X.q, y + 3.2, B, 7, C.deep, "center"); text("TOTAL", X.t, y + 3.2, B, 7, C.deep, "right"); y += 9; };
  head();
  for (const l of inv.lines) {
    const dl = wrap(l.desc, R, 9, X.p - 22 - X.d).slice(0, 3); const h = Math.max(10.5, dl.length * 4.4 + (l.sku ? 4 : 0) + 5);
    if (y + h > H - 30) { y = await newPage(false); head(); }
    let ly = y + 3.2; for (const t of dl) { text(t, X.d, ly, R, 9); ly += 4.4; } if (l.sku) text(l.sku, X.d, ly, R, 7, C.muted);
    text(rand(l.unit), X.p, y + 3.2, R, 9, C.ink, "right"); text(String(l.qty), X.q, y + 3.2, R, 9, C.ink, "center"); text(rand(l.total), X.t, y + 3.2, B, 9, C.ink, "right");
    y += h; hl(y);
  }
  if (y + 60 > H - 26) y = await newPage(false);
  y += 6; const tW = 78, tX = W - MX - tW; let ty = y;
  const rows = inv.vatReg ? [["Subtotal (excl. VAT)", rand(inv.total - inv.vat)], [`VAT ${inv.vatBp / 100}%`, rand(inv.vat)]] : [["Subtotal", rand(inv.total)]];
  for (const [k, v] of rows) { text(k, tX + 4, ty + 2, R, 8.8, C.muted); text(v, W - MX - 4, ty + 2, R, 8.8, C.ink, "right"); ty += 8; hl(ty, tX); }
  ty += 2; rect(tX, ty, tW, 12, paid ? C.mist : C.deep);
  text(paid ? "Total" : "Total due", tX + 4, ty + 3.6, B, 10, paid ? C.ink : C.white); text(rand(inv.total), W - MX - 4, ty + 2.8, B, 13, paid ? C.ink : C.white, "right"); ty += 12;
  if (paid) { text(`Paid${inv.paidMethod ? " · " + PAID_M[inv.paidMethod] : ""}${inv.paidAt ? " · " + sDate(saYmd(inv.paidAt)) : ""}`, tX + 4, ty + 3, R, 8, C.deep); rect(tX, ty + 8, tW, 10, C.soft); text("Balance due", tX + 4, ty + 10.6, B, 9, C.deep); text("R0.00", W - MX - 4, ty + 10.4, B, 11, C.deep, "right"); }
  let ly = y; const iw = tX - MX - 10;
  if (inv.pay) { lbl("Payment information", MX, ly); ly += 5.5; for (const t of wrap(inv.pay, R, 8.2, iw)) { text(t, MX, ly, R, 8.2); ly += 4; } ly += 3.5; }
  if (inv.notes) { lbl("Notes", MX, ly); ly += 5.5; for (const t of wrap(inv.notes, R, 8.2, iw)) { text(t, MX, ly, R, 8.2); ly += 4; } }
  if (!inv.pay && !inv.notes && inv.source === "sale") { lbl("Payment", MX, ly); text(`Paid in full at the till (receipt ${inv.receiptNo}).`, MX, ly + 5.5, R, 8.2); }
  pages.forEach((p, i) => {
    page = p;
    if (inv.status === "void" || inv.status === "draft") p.drawText(inv.status === "void" ? "VOID" : "DRAFT", { x: 60 * MM, y: 110 * MM, size: 110, font: B, color: inv.status === "void" ? C.danger : C.muted, opacity: 0.08, rotate: degrees(30) });
    rect(0, H - 16, W, 16, C.deep); rect(0, H - 16, W, 0.9, C.lime);
    text(b.thanks, MX, H - 10.6, B, 10, C.white);
    const right = [b.phone && `Tel ${b.phone}`, b.email].filter(Boolean).join("  ·  ") + (pages.length > 1 ? `   Page ${i + 1} of ${pages.length}` : "");
    if (right.trim()) text(right, W - MX, H - 10.2, R, 7.8, hx("#D9F99D"), "right");
  });
  await savePdf(`${inv.vatReg ? "Tax-invoice" : "Invoice"}-${inv.no || "draft"}.pdf`, await doc.save());
}

// ---- POS opt-in -------------------------------------------------------------
let saleInv = { on: false, email: "", name: "" };
function invOptHtml() {
  const sugg = saleInv.on && (saleInv.email || saleInv.name).trim().length >= 2 ? custSearch(saleInv.email || saleInv.name).filter((c) => c.email !== saleInv.email.trim().toLowerCase()).slice(0, 3) : [];
  return `<div class="invopt ${saleInv.on ? "on" : ""}"><label class="invsw"><span class="dlg-ic" style="width:36px;height:36px;border-radius:12px">${icon("receipts")}</span><span style="flex:1"><strong style="display:block;font-size:.9rem">Make an invoice for the customer</strong><span class="small muted">Saved to Invoices as a PDF you can e-mail</span></span>
    <input type="checkbox" id="invOn" role="switch" ${saleInv.on ? "checked" : ""}><span class="sw" aria-hidden="true"></span></label>
    ${saleInv.on ? `<div class="fields" style="margin-top:10px"><label class="f" for="invEmail">Customer e-mail<input id="invEmail" class="i" type="text" inputmode="email" autocapitalize="off" spellcheck="false" autocomplete="off" value="${esc(saleInv.email)}" placeholder="name@example.com"></label><label class="f" for="invName">Name (optional)<input id="invName" class="i" autocomplete="off" value="${esc(saleInv.name)}"></label></div>
    ${sugg.length ? `<div class="row" style="margin-top:6px">${sugg.map((c) => `<button type="button" class="btn ghost" style="min-height:36px;font-size:.8rem" data-invcust="${esc(custKey(c))}">${esc(c.name)} · ${esc(c.email || "")}</button>`).join("")}</div>` : ""}
    ${saleInv.email && !isMail(saleInv.email) ? `<p class="small" style="color:var(--danger);margin-top:6px">Check the e-mail address.</p>` : ""}` : ""}</div>`;
}
function custSearch(term) {
  const t = term.trim().toLowerCase(); if (t.length < 2) return [];
  return Object.values(S.invoices?.customers || {}).filter((c) => [c.name, c.email, c.company, c.phone].some((x) => (x || "").toLowerCase().includes(t))).sort((a, b) => (b.at || "").localeCompare(a.at || "")).slice(0, 6);
}
async function afterSaleInvoice(sale, date, bill) {
  S.doneInv = { status: "making" }; render();
  try { const inv = await invoiceFromSale(sale, date, bill); S.doneInv = { status: "ready", id: inv.id, no: inv.no, to: inv.bill.email }; }
  catch (e) { S.doneInv = { status: "failed", error: e instanceof AppErr ? e.message : "The invoice could not be saved. Try again from the receipt." }; }
  render();
}
function doneInvHtml() {
  const d = S.doneInv;
  if (!d) return S.done ? `<div class="row"><button class="btn" data-act="saleInvOpen">${icon("receipts")} Make an invoice</button></div>` : "";
  if (d.status === "making") return `<div class="invstat">Saving invoice…</div>`;
  if (d.status === "failed") return `<div class="invstat bad">${esc(d.error)}</div>`;
  return `<div class="invstat">${icon("check")}<span><strong>Invoice ${esc(d.no)}</strong> saved for ${esc(d.to)}</span><span style="margin-left:auto" class="row"><button class="btn" data-invsend="${d.id}">${icon("data")} PDF + e-mail</button>${isOwner() ? `<button class="btn ghost" data-invopen="${d.id}">Open</button>` : ""}</span></div>`;
}
function openSaleInvoiceDialog(date, key) {
  dialog("Make an invoice", `<form id="saleInvForm" class="stack" data-date="${esc(date)}" data-key="${esc(key)}"><div class="fields"><label class="f" for="siEmail">Customer e-mail<input id="siEmail" class="i" type="text" inputmode="email" autocapitalize="off" spellcheck="false" required autocomplete="off" autofocus></label><label class="f" for="siName">Name (optional)<input id="siName" class="i" autocomplete="off"></label></div>
    <div class="fields"><label class="f" for="siCo">Company (optional)<input id="siCo" class="i" maxlength="120"></label><label class="f" for="siVat">Their VAT number (optional)<input id="siVat" class="i" maxlength="20"></label></div><div id="siErr"></div></form>`,
    { icon: "receipts", sub: "A paid invoice for this sale, saved under Invoices.", foot: `<button class="btn ghost" data-close>Cancel</button><button class="btn primary" type="submit" form="saleInvForm">Save invoice</button>` });
}
async function saleInvSubmit(form) {
  const email = $("#siEmail").value.trim(); if (!isMail(email)) { $("#siErr").innerHTML = `<div class="alert error">Enter the customer's e-mail address.</div>`; return; }
  const date = form.dataset.date, key = form.dataset.key; const doc = date === S.dayDate ? S.day : await getDay(date); const sale = doc.sales.find((x) => x.key === key);
  closeDialog();
  if (S.done && S.done.key === key) return afterSaleInvoice(sale, date, { email, name: $("#siName")?.value || "", company: "", vat: "" });
  try { const inv = await invoiceFromSale(sale, date, { email, name: $("#siName").value.trim(), company: $("#siCo").value.trim(), vat: $("#siVat").value.trim() }); toast(`Invoice ${inv.no} saved.`); invUI = { ...invUI, mode: "view", id: inv.id, doc: inv }; S.view = isOwner() ? "invoices" : S.view; render(); }
  catch { toast("The invoice could not be saved."); }
}

// ---- Invoices section (owner) --------------------------------------------------
let invUI = { mode: "list", filter: "all", term: "", id: null, doc: null, ed: null, err: null, itemQ: "", custQ: "", tab: "edit" };
function blankEd() {
  const s = S.settings || {}; const t = today(); const terms = s.invTerms ?? 7;
  return { id: null, bill: { name: "", company: "", email: "", phone: "", address: "", vat: "" }, issue: t, due: terms ? addDays(t, terms) : "", ref: "", notes: "", pay: s.invPay || "", lines: [{ desc: "", sku: "", qty: "1", price: "", vid: null }] };
}
function edLines(ed) {
  const bp = S.settings?.vatRegistered ? S.settings.vatRateBp ?? 1500 : 0;
  return ed.lines.map((l) => { const q = /^\d+$/.test(l.qty) ? +l.qty : NaN; const u = l.price === "" ? null : parseRand(l.price); const total = Number.isFinite(q) && u !== null ? q * u : 0; return { ...l, q, u, total, vat: vatIn(total, bp) }; });
}
function edToInv(ed) {
  const ls = edLines(ed).filter((l) => l.desc.trim() || l.u !== null); const s = S.settings || {};
  const total = ls.reduce((a, l) => a + l.total, 0), vat = ls.reduce((a, l) => a + l.vat, 0);
  return { id: ed.id, no: null, source: "manual", status: "draft", bill: { ...ed.bill }, issue: ed.issue, due: ed.due || null, ref: ed.ref, notes: ed.notes, pay: ed.pay,
    lines: ls.map((l) => ({ desc: l.desc.trim(), sku: l.sku, qty: Number.isFinite(l.q) ? l.q : 0, unit: l.u ?? 0, total: l.total, vat: l.vat, vid: l.vid })),
    total, vat, vatReg: !!s.vatRegistered, vatBp: s.vatRegistered ? s.vatRateBp ?? 1500 : 0, biz: invBiz() };
}
function viewInvoices() {
  if (invUI.mode === "edit") return viewInvEditor();
  if (invUI.mode === "view") return viewInvDetail();
  const items = Object.values(S.invoices?.items || {}); const t = today();
  const st = { out: 0, outN: 0, over: 0, overN: 0, paidM: 0, drafts: 0 }; const month = t.slice(0, 7);
  for (const x of items) { if (x.status === "issued") { st.out += x.total; st.outN++; if (x.due && x.due < t) { st.over += x.total; st.overN++; } } if (x.status === "paid" && (x.paidAt ? saYmd(x.paidAt) : x.issue).slice(0, 7) === month) st.paidM += x.total; if (x.status === "draft") st.drafts++; }
  const F = [["all", "All"], ["draft", "Drafts"], ["issued", "Awaiting payment"], ["overdue", "Overdue"], ["paid", "Paid"], ["void", "Void"]];
  const q = invUI.term.trim().toLowerCase();
  const rows = items.filter((x) => invUI.filter === "all" || (invUI.filter === "overdue" ? x.status === "issued" && x.due && x.due < t : x.status === invUI.filter))
    .filter((x) => !q || [x.no, x.name, x.company, x.email].some((v) => (v || "").toLowerCase().includes(q)))
    .sort((a, b) => (b.status === "draft") - (a.status === "draft") || (b.issue || "").localeCompare(a.issue || "") || (b.createdAt || "").localeCompare(a.createdAt || ""));
  const tile = (l, v, s, ic, tone = "") => `<div class="card itile"><span class="dlg-ic ${tone}">${icon(ic)}</span><div><p class="small muted">${l}</p><p class="tab" style="font-size:1.35rem;font-weight:700">${v}</p><p class="small muted">${s}</p></div></div>`;
  return `<div class="page"><div class="row" style="justify-content:space-between;align-items:flex-end"><div><h1>Invoices</h1><p class="muted small">Every invoice from the till and every invoice you make by hand.</p></div><button class="btn primary lg" data-act="invNew">${icon("receipts")} New invoice</button></div>
  <div class="itiles">${tile("Awaiting payment", rand(st.out), `${st.outN} invoice${st.outN === 1 ? "" : "s"}`, "report")}${tile("Overdue", rand(st.over), `${st.overN} past due`, "alert", st.overN ? "warn" : "")}${tile("Paid this month", rand(st.paidM), "Till and manual", "check")}${tile("Drafts", st.drafts, "Not sent yet", "data")}</div>
  <div class="row" style="justify-content:space-between"><nav class="subtabs" aria-label="Filter invoices">${F.map(([k, l]) => `<button data-invfilter="${k}" ${invUI.filter === k ? 'aria-current="page"' : ""}>${l}</button>`).join("")}</nav>
    <label class="f" style="width:min(100%,300px)" for="invq"><span class="sr">Search invoices</span><input id="invq" class="i" type="search" value="${esc(invUI.term)}" placeholder="Number, customer or e-mail"></label></div>
  ${rows.length ? `<div class="stack" style="gap:8px">${rows.map((x) => { const [bl, bt] = invBadge(x); return `<button class="card irow" data-invopen="${x.id}"><span class="row ino" style="gap:10px;flex-wrap:nowrap;white-space:nowrap"><span class="dlg-ic" style="width:34px;height:34px;border-radius:10px">${icon(x.source === "sale" ? "till" : "receipts")}</span><strong class="tab">${esc(x.no || "Draft")}</strong></span>
      <span class="icu" style="min-width:0"><strong style="display:block;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(x.company || x.name || "No customer yet")}</strong><span class="small muted">${x.sent ? "✉ " : ""}${esc(x.email || "")} · ${sDate(x.issue)}</span></span>
      <span class="tab iam" style="font-weight:700;text-align:right">${rand(x.total)}</span><span class="pill ${bt} ipl">${bl}</span></button>`; }).join("")}</div>`
    : `<div class="empty"><span class="dlg-ic" style="margin:0 auto 8px">${icon("receipts")}</span><p style="font-weight:600">${q || invUI.filter !== "all" ? "No invoices match" : "No invoices yet"}</p><p class="small muted">Switch on “Make an invoice” when taking payment at the POS, or make one by hand.</p></div>`}</div>`;
}
function viewInvEditor() {
  const ed = invUI.ed; const ls = edLines(ed); const inv = edToInv(ed);
  const items = invUI.itemQ.trim().length >= 2 ? searchVariants(invUI.itemQ).slice(0, 6) : null;
  const custs = invUI.custQ.trim().length >= 2 ? custSearch(invUI.custQ) : null;
  const dueChoice = !ed.due || ed.due === ed.issue ? 0 : [7, 14, 30].find((d) => addDays(ed.issue, d) === ed.due);
  const step = (n, ic, title, sub, body) => `<section class="card"><div class="stephd"><span class="dlg-ic">${icon(ic)}</span><div><h2>${title}</h2>${sub ? `<p>${sub}</p>` : ""}</div></div>${body}</section>`;
  const form = `<div class="stack" style="gap:16px">
    ${step(1, "products", "Who is it for?", "Pick a saved customer or type new details.", `<div class="lsearch" style="margin-bottom:12px">${icon("scan")}<input id="edCustQ" value="${esc(invUI.custQ)}" placeholder="Search saved customers" autocomplete="off">
      ${custs ? `<div class="lres">${custs.length ? custs.map((c) => `<button data-edcust="${esc(custKey(c))}"><strong>${esc(c.name)}</strong><span class="small muted">${esc(c.company ? c.company + " · " : "")}${esc(c.email || c.phone || "")}</span></button>`).join("") : `<p class="small muted" style="padding:12px">No saved customer matches.</p>`}</div>` : ""}</div>
      <div class="fields"><label class="f" for="edName">Customer name *<input id="edName" class="i" maxlength="120" value="${esc(ed.bill.name)}"></label><label class="f" for="edEmail">E-mail<input id="edEmail" class="i" type="text" inputmode="email" autocapitalize="off" spellcheck="false" maxlength="200" value="${esc(ed.bill.email)}"></label></div>
      <div class="fields" style="margin-top:10px"><label class="f" for="edCo">Company<input id="edCo" class="i" maxlength="120" value="${esc(ed.bill.company)}"></label><label class="f" for="edVat">Their VAT number<input id="edVat" class="i" maxlength="20" value="${esc(ed.bill.vat)}"></label></div>
      <label class="f" for="edAddr" style="margin-top:10px">Address<textarea id="edAddr" class="i" maxlength="400">${esc(ed.bill.address)}</textarea></label>`)}
    ${step(2, "report", "Dates and reference", "", `<div class="fields"><label class="f" for="edIssue">Invoice date<input id="edIssue" class="i" type="date" value="${ed.issue}"></label><label class="f" for="edRef">Reference (e.g. their order no.)<input id="edRef" class="i" maxlength="80" value="${esc(ed.ref)}"></label></div>
      <p class="small" style="font-weight:600;margin-top:12px">Payment due</p><div class="row" style="margin-top:6px">${[[0, "On receipt"], [7, "7 days"], [14, "14 days"], [30, "30 days"]].map(([d, l]) => `<button type="button" class="chip" aria-pressed="${dueChoice === d}" data-eddue="${d}">${l}</button>`).join("")}<input id="edDue" type="date" class="i" style="width:auto;min-height:40px" min="${ed.issue}" value="${ed.due}" aria-label="Due date"></div>`)}
    ${step(3, "leaf", "What are you charging for?", "Add plants from your catalogue, or type any item or service. Prices include VAT.", `<div class="lsearch">${icon("scan")}<input id="edItemQ" value="${esc(invUI.itemQ)}" placeholder="Add from catalogue — plant, SKU or barcode" autocomplete="off">
      ${items ? `<div class="lres">${items.length ? items.map((v) => `<button data-edadd="${v.id}"><span style="flex:1"><strong>${esc(v.name)}</strong> <span class="small muted">${esc(v.size)}</span></span><span class="tab">${rand(v.price)}</span><span class="pill">+ Add</span></button>`).join("") : `<p class="small muted" style="padding:12px">Nothing matches — add a custom line below.</p>`}</div>` : ""}</div>
      <div class="stack" style="margin-top:12px;gap:8px">${ls.map((l, i) => `<div class="litem" style="flex-direction:column;align-items:stretch"><label class="f" for="edD${i}"><span class="row" style="gap:6px">Item ${i + 1}${l.vid ? '<span class="pill green">Catalogue</span>' : ""}</span><input id="edD${i}" class="i" data-edd="${i}" maxlength="200" value="${esc(l.desc)}" placeholder="e.g. Garden service — 2 hours"></label>
        <div class="row" style="align-items:flex-end"><div><span class="small muted">Qty</span><div class="mini"><button type="button" data-edstep="${i}|-1" aria-label="One fewer">−</button><input id="edQ${i}" class="tab" data-edq="${i}" inputmode="numeric" value="${esc(l.qty)}" aria-label="Quantity"><button type="button" data-edstep="${i}|1" aria-label="One more">+</button></div></div>
        <label class="f" for="edP${i}" style="width:130px">Price each (R)<input id="edP${i}" class="i tab" data-edp="${i}" inputmode="decimal" style="text-align:right;${l.price && l.u === null ? "border-color:var(--danger)" : ""}" value="${esc(l.price)}" placeholder="0.00"></label>
        <span style="margin-left:auto;text-align:right"><span class="small muted">Line total</span><br><strong class="tab" style="font-size:1.1rem">${rand(l.total)}</strong></span><button class="xbtn" data-edrm="${i}" aria-label="Remove item ${i + 1}">✕</button></div></div>`).join("")}</div>
      <button class="btn ghost" style="width:100%;margin-top:10px;border:1px dashed var(--field)" data-act="edAddLine">+ Add a custom line</button>`)}
    ${step(4, "data", "Payment details and notes", "Printed at the bottom of the invoice.", `<div class="fields"><label class="f" for="edPay">How to pay<textarea id="edPay" class="i" maxlength="600" placeholder="Bank, account number, branch, reference">${esc(ed.pay)}</textarea></label><label class="f" for="edNotes">Notes for the customer<textarea id="edNotes" class="i" maxlength="1000">${esc(ed.notes)}</textarea></label></div>`)}
  </div>`;
  return `<div class="page" style="padding-bottom:110px"><div class="row" style="justify-content:space-between"><div class="row"><button class="xbtn" style="border:1px solid var(--line);border-radius:12px;width:44px;height:44px" data-act="invBack" aria-label="Back to invoices">←</button><div><h1>${ed.id ? "Edit draft invoice" : "New invoice"}</h1><p class="small muted">The invoice preview updates as you type.</p></div></div>
    <div class="seg ietab" role="tablist"><button role="tab" aria-checked="${invUI.tab === "edit"}" data-invtab="edit">Edit</button><button role="tab" aria-checked="${invUI.tab === "preview"}" data-invtab="preview">Preview</button></div></div>
  <div class="ieditor tab-${invUI.tab}"><div class="ieform">${form}</div><div class="iepreview"><p class="small muted" style="font-weight:600;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Live preview</p>${invDocHtml(inv)}</div></div>
  <div class="iebar"><div><p class="small muted">${ed.bill.name ? `For <strong style="color:var(--ink)">${esc(ed.bill.company || ed.bill.name)}</strong>` : "No customer yet"}</p><p class="tab" style="font-size:1.3rem;font-weight:700">${rand(inv.total)}</p></div>
    ${invUI.err ? `<div class="alert error small">${esc(invUI.err)}</div>` : ""}
    <div class="row"><button class="btn ghost" data-edsave="draft">Save draft</button><button class="btn" data-edsave="issue">Issue</button><button class="btn primary" data-edsave="send" ${isMail(ed.bill.email) ? "" : "disabled"}>Issue &amp; e-mail</button></div></div></div>`;
}
function viewInvDetail() {
  const inv = invUI.doc; if (!inv) return `<div class="page"><p class="muted">Loading invoice…</p></div>`;
  const [bl, bt] = invBadge(inv); const canSend = inv.status === "issued" || inv.status === "paid";
  const ev = [[inv.createdAt, inv.source === "sale" ? `Created from till sale ${inv.receiptNo}` : "Draft created"], ...(inv.issuedAt && inv.source === "manual" ? [[inv.issuedAt, `Issued as ${inv.no}`]] : []),
    ...(inv.emails || []).map((e) => [e.at, `E-mail prepared to ${e.to}`]), ...(inv.paidAt && inv.source === "manual" ? [[inv.paidAt, `Paid${inv.paidMethod ? " · " + PAID_M[inv.paidMethod] : ""}`]] : []), ...(inv.voidedAt ? [[inv.voidedAt, `Voided — ${inv.voidReason}`]] : [])]
    .map((e, i) => [...e, i]).sort((a, b) => (b[0] || "").localeCompare(a[0] || "") || b[2] - a[2]);
  return `<div class="page"><div class="row" style="justify-content:space-between;align-items:flex-start"><div class="row" style="align-items:flex-start"><button class="xbtn" style="border:1px solid var(--line);border-radius:12px;width:44px;height:44px" data-act="invBack" aria-label="Back to invoices">←</button>
    <div><p class="small muted">${invTitle(inv)}${inv.source === "sale" ? " · from the till" : ""}</p><h1 class="row"><span class="tab">${esc(inv.no || "Draft invoice")}</span><span class="pill ${bt}" style="font-size:.85rem">${bl}</span></h1><p class="small muted">${esc(inv.bill.company || inv.bill.name)} · ${rand(inv.total)} · ${sDate(inv.issue)}</p></div></div>
    <div class="row">${inv.status === "draft" ? `<button class="btn" data-act="invEdit">Edit</button><button class="btn primary" data-act="invIssue">Issue invoice</button><button class="btn ghost" style="color:var(--danger)" data-act="invDelete">Delete draft</button>` : ""}
      ${canSend ? `<button class="btn" data-act="invPdf">${icon("data")} PDF</button>${inv.status === "issued" ? `<button class="btn" data-act="invPaid">${icon("check")} Mark as paid</button>` : ""}<button class="btn primary" data-act="invMail" ${inv.bill.email ? "" : "disabled"}>✉ E-mail invoice</button>` : ""}
      ${inv.source === "manual" && canSend ? `<button class="btn ghost" data-act="invDup">Duplicate</button><button class="btn ghost" style="color:var(--danger)" data-act="invVoid">Void</button>` : ""}${inv.source === "manual" && inv.status === "void" ? `<button class="btn ghost" data-act="invDup">Duplicate</button>` : ""}</div></div>
  <div class="idetail">${invDocHtml(inv)}<aside class="stack">
    <section class="card"><p class="small muted" style="font-weight:600;text-transform:uppercase">Amount</p><p class="tab" style="font-size:1.8rem;font-weight:700">${rand(inv.total)}</p><p class="small" style="color:${bt === "green" ? "var(--forest)" : bt === "danger" ? "var(--danger)" : "var(--warn)"};font-weight:600">${inv.status === "paid" ? "Paid" + (inv.paidMethod ? " · " + PAID_M[inv.paidMethod] : "") : inv.status === "issued" ? (inv.due && inv.due !== inv.issue ? "Due " + sDate(inv.due) : "Due on receipt") : inv.status === "void" ? "Void — not payable" : "Draft — not sent"}</p></section>
    <section class="card"><p class="small muted" style="font-weight:600;text-transform:uppercase">Customer</p><p style="font-weight:600;margin-top:6px">${esc(inv.bill.name)}</p>${inv.bill.company ? `<p class="small">${esc(inv.bill.company)}</p>` : ""}<p class="small" style="word-break:break-all">${esc(inv.bill.email || "No e-mail address")}</p></section>
    <section class="card"><p class="small muted" style="font-weight:600;text-transform:uppercase">Activity</p><ol class="itl">${ev.map(([at, t]) => `<li><span></span><div><p class="small" style="font-weight:600">${esc(t)}</p><p class="small muted">${at ? dt(at) : ""}</p></div></li>`).join("")}</ol></section>
    <p class="small muted">This live version prepares the e-mail in your own mail app with the PDF saved for attaching. The full Rietvalei POS server sends invoices automatically.</p></aside></div></div>`;
}
async function openInvoice(id) { invUI = { ...invUI, mode: "view", id, doc: null, err: null }; S.view = "invoices"; render(); invUI.doc = await loadInvoice(id); render(); }
function edCheck(ed) {
  const ls = edLines(ed).filter((l) => l.desc.trim() || l.u !== null);
  if (!ed.bill.name.trim()) return "Enter the customer's name.";
  if (ed.bill.email && !isMail(ed.bill.email)) return "Check the customer's e-mail address.";
  if (!ls.length) return "Add at least one item.";
  if (ls.some((l) => !l.desc.trim())) return "Every line needs a description.";
  if (ls.some((l) => !Number.isFinite(l.q) || l.q < 1)) return "Quantities must be whole numbers of 1 or more.";
  if (ls.some((l) => l.u === null)) return "Enter each price in rand, e.g. 89.90";
  if (ed.due && ed.due < ed.issue) return "The due date can't be before the invoice date.";
  return null;
}
async function edSave(mode) {
  const ed = invUI.ed; const problem = edCheck(ed); if (problem) { invUI.err = problem; return render(); }
  const base = edToInv(ed); const prev = ed.id ? await loadInvoice(ed.id) : null;
  if (prev && prev.status !== "draft") { invUI.err = "This invoice was issued elsewhere and can no longer be edited."; return render(); }
  const inv = { ...base, id: ed.id || uuid(), createdAt: prev?.createdAt || new Date().toISOString(), by: prev?.by || S.me?.id || null, emails: prev?.emails || [] };
  try {
    const saved = await putInvoice(inv, { issue: mode !== "draft" });
    invUI = { ...invUI, mode: "view", id: saved.id, doc: saved, ed: null, err: null, itemQ: "", custQ: "" }; render();
    if (mode === "send") await sendInvoice(saved); else toast(mode === "draft" ? "Draft saved. It gets a number when you issue it." : `${saved.no} issued.`);
    invUI.doc = await loadInvoice(saved.id); render();
  } catch (e) { invUI.err = e instanceof AppErr ? e.message : "Could not save. Check the connection."; render(); }
}
async function invAction(act) {
  const inv = invUI.doc;
  if (act === "invNew") { invUI = { ...invUI, mode: "edit", ed: blankEd(), err: null, tab: "edit" }; return render(); }
  if (act === "invBack") { invUI = { ...invUI, mode: "list", doc: null, ed: null, err: null }; return render(); }
  if (act === "edAddLine") { invUI.ed.lines.push({ desc: "", sku: "", qty: "1", price: "", vid: null }); render(); return $(`#edD${invUI.ed.lines.length - 1}`)?.focus(); }
  if (!inv) return;
  if (act === "invEdit") { invUI = { ...invUI, mode: "edit", tab: "edit", err: null, ed: { id: inv.id, bill: { ...inv.bill }, issue: inv.issue, due: inv.due || "", ref: inv.ref, notes: inv.notes, pay: inv.pay, lines: inv.lines.map((l) => ({ desc: l.desc, sku: l.sku, qty: String(l.qty), price: centsIn(l.unit), vid: l.vid })) } }; return render(); }
  if (act === "invIssue") { const fresh = await loadInvoice(inv.id); if (fresh.status !== "draft") return toast("Already issued."); invUI.doc = await putInvoice(fresh, { issue: true }); toast(`${invUI.doc.no} issued.`); return render(); }
  if (act === "invPdf") return invoicePdf(inv);
  if (act === "invMail") return sendInvoice(inv).then(async () => { invUI.doc = await loadInvoice(inv.id); render(); });
  if (act === "invDup") { invUI = { ...invUI, mode: "edit", tab: "edit", err: null, ed: { ...blankEd(), bill: { ...inv.bill }, notes: inv.notes, pay: inv.pay || S.settings?.invPay || "", lines: inv.lines.map((l) => ({ desc: l.desc, sku: l.sku, qty: String(l.qty), price: centsIn(l.unit), vid: l.vid })) } }; return render(); }
  if (act === "invDelete") return dialog("Delete this draft?", `<p class="small muted">Drafts were never sent, so nothing is kept. This can't be undone.</p>`, { icon: "alert", tone: "danger", foot: `<button class="btn ghost" data-close>Cancel</button><button class="btn danger" data-act="invDeleteGo">Delete draft</button>` });
  if (act === "invDeleteGo") { await withLock(async () => { const idx = await get(DOCS.invoices, { items: {}, customers: {} }); delete idx.items[inv.id]; await S.db.doc(DOCS.invoices).set(idx); await S.db.doc(`invoices/${inv.id}`).set({ deleted: true }); }); closeDialog(); invUI = { ...invUI, mode: "list", doc: null }; toast("Draft deleted."); return render(); }
  if (act === "invPaid") return dialog("Mark as paid", `<form id="invPaidForm" class="stack"><div class="opts">${Object.entries(PAID_M).map(([k, l], i) => `<label class="opt"><input type="radio" name="ipm" value="${k}" ${i === 0 ? "checked" : ""}><span class="oi">${icon(k === "cash" ? "till" : k === "card" ? "receipts" : "report")}</span><strong>${l}</strong></label>`).join("")}</div>
    <div class="fields"><label class="f" for="ipDate">Date received<input id="ipDate" class="i" type="date" max="${today()}" value="${today()}"></label><label class="f" for="ipRef">Reference (optional)<input id="ipRef" class="i" maxlength="60"></label></div></form>`,
    { icon: "check", sub: `${esc(inv.no)} · ${rand(inv.total)}`, foot: `<button class="btn ghost" data-close>Cancel</button><button class="btn primary" type="submit" form="invPaidForm">Mark as paid</button>` });
  if (act === "invVoid") return dialog("Void this invoice?", `<form id="invVoidForm" class="stack"><p class="small muted">It stays on record marked VOID and can't be paid.</p><label class="f" for="ivReason">Reason<input id="ivReason" class="i" maxlength="300" autofocus placeholder="e.g. Customer cancelled the order"></label><div id="ivErr"></div></form>`,
    { icon: "alert", tone: "danger", foot: `<button class="btn ghost" data-close>Keep it</button><button class="btn danger" type="submit" form="invVoidForm">Void invoice</button>` });
}
async function invPaidSubmit() {
  const inv = await loadInvoice(invUI.doc.id); if (inv.status !== "issued") { closeDialog(); return toast("Only issued invoices can be marked as paid."); }
  const m = document.querySelector("input[name=ipm]:checked").value; const d = $("#ipDate").value || today();
  inv.status = "paid"; inv.paidMethod = m; inv.paidRef = $("#ipRef").value.trim(); inv.paidAt = new Date(`${d}T12:00:00+02:00`).toISOString();
  invUI.doc = await putInvoice(inv); closeDialog(); toast("Marked as paid."); render();
}
async function invVoidSubmit() {
  const why = $("#ivReason").value.trim(); if (why.length < 3) { $("#ivErr").innerHTML = `<div class="alert error">Say why the invoice is being voided.</div>`; return; }
  const inv = await loadInvoice(invUI.doc.id); inv.status = "void"; inv.voidReason = why; inv.voidedAt = new Date().toISOString();
  invUI.doc = await putInvoice(inv); closeDialog(); toast("Invoice voided."); render();
}
