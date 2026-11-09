// ---------------------------------------------------------------- nav + render
const IC = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  till: '<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>',
  products: '<path d="M7 20h10"/><path d="M10 20c5.5-2.5.8-6.4 3-10"/><path d="M9.5 9.4c1.1.8 1.8 2.2 2.3 3.7-2 .4-3.5.4-4.8-.3-1.2-.6-2.3-1.9-3-4.2 2.8-.5 4.4 0 5.5.8z"/><path d="M14.1 6a7 7 0 0 0-1.1 4c1.9-.1 3.3-.6 4.3-1.4 1-1 1.6-2.3 1.7-4.6-2.7.1-4 1-4.9 2z"/>',
  stock: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5"/><path d="M12 13v8"/>',
  labels: '<path d="M3 5v14M7 5v14M10 5v14M14 5v14M17 5v14M21 5v14"/>',
  receipts: '<path d="M4 2v20l3-2 3 2 3-2 3 2 3-2 2 2V2l-2 2-3-2-3 2-3-2-3 2-3-2z"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  report: '<path d="M3 3v18h18"/><path d="M8 17v-5M13 17V8M18 17v-9"/>',
  data: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h8M12 11v8"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  leaf: '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>',
};
const icon = (k, cls = "ico") => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[k]}</svg>`;
const VIEWS = [
  ["dashboard", "Dashboard", "owner"], ["till", "POS", "sell"], ["products", "Products", "owner"], ["stock", "Inventory", "owner"],
  ["labels", "Barcode Labels", "sell"], ["receipts", "Sales", "sell"], ["report", "Reports", "owner"], ["data", "Import/Export", "owner"], ["settings", "Settings", "owner"],
];
const GROUP = { receive: "stock", cash: "receipts" };
const SUBTABS = {
  stock: [["stock", "Stock levels"], ["receive", "Receive stock"]], receive: [["stock", "Stock levels"], ["receive", "Receive stock"]],
  receipts: [["receipts", "Receipts & returns"], ["cash", "Till & cash-up"]], cash: [["receipts", "Receipts & returns"], ["cash", "Till & cash-up"]],
};
const initials = (n) => (n || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
function render() {
  if (!S.db) return;
  const ready = S.loaded.catalog && S.loaded.stock && S.loaded.settings && S.loaded.till;
  $("#brand").textContent = S.settings?.businessName || "Nursery Till";
  $("#tillPill").hidden = !S.till?.open;
  const roleName = isOwner() ? "Owner" : S.role === "cashier" ? "Cashier" : "View only";
  $("#who").innerHTML = S.me?.name ? `<strong>${esc(S.me.name)}</strong><br><span style="opacity:.85">${roleName}</span>` : roleName;
  $("#whoTop").innerHTML = `<span class="avatar" aria-hidden="true">${esc(initials(S.me?.name))}</span><span class="nm">${esc(S.me?.name || "")} <span class="muted">· ${roleName}</span></span>`;
  const active = GROUP[S.view] || S.view;
  $("#tabs").innerHTML = VIEWS.filter(([, , who]) => who === "sell" ? canSell() || S.role === "viewer" : isOwner())
    .map(([k, t]) => `<button data-nav="${k}" ${active === k ? 'aria-current="page"' : ""}>${icon(k)}<span>${t}</span></button>`).join("");
  if (!ready) return;
  const keep = captureFocus();
  const fn = { dashboard: viewDashboard, data: viewData, till: viewTill, receipts: viewReceipts, cash: viewCash, receive: viewReceive, labels: viewLabels, products: viewProducts, stock: viewStock, report: viewReport, settings: viewSettings }[S.view] || viewTill;
  let html = fn();
  const tabs = SUBTABS[S.view];
  if (tabs && (isOwner() || S.view === "receipts" || S.view === "cash")) {
    const bar = `<nav class="subtabs" aria-label="Section">${tabs.filter(([k]) => isOwner() || !["stock", "receive"].includes(k)).map(([k, t]) => `<button data-nav="${k}" ${S.view === k ? 'aria-current="page"' : ""}>${t}</button>`).join("")}</nav>`;
    html = html.replace(/(<div class="page"[^>]*>)/, `$1${bar}`);
  }
  $("#main").innerHTML = html;
  restoreFocus(keep);
  afterRender();
}
function captureFocus() { const a = document.activeElement; return a && a.id ? { id: a.id, s: a.selectionStart, e: a.selectionEnd } : null; }
function restoreFocus(k) { if (!k) return; const el = document.getElementById(k.id); if (el) { el.focus(); try { if (k.s != null) el.setSelectionRange(k.s, k.e); } catch {} } }
let afterHooks = [];
function afterRender() { const h = afterHooks; afterHooks = []; h.forEach((f) => f()); }
document.addEventListener("click", (e) => {
  if (e.target.closest("#menuBtn")) { const o = document.body.classList.toggle("menu-open"); $("#menuBtn").setAttribute("aria-expanded", String(o)); return; }
  if (document.body.classList.contains("menu-open") && (e.target.closest("[data-nav]") || !e.target.closest("#side"))) { document.body.classList.remove("menu-open"); $("#menuBtn").setAttribute("aria-expanded", "false"); }
}, true);
document.addEventListener("submit", (e) => {
  if (e.target.id !== "topSearch") return;
  e.preventDefault(); e.stopImmediatePropagation();
  const t = $("#topq").value.trim();
  if (isOwner() && S.view !== "till") { prod.term = t; S.view = "products"; } else { S.search = t; S.view = "till"; }
  render();
}, true);

