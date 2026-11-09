// ---------------------------------------------------------------- DASHBOARD (owner)
let dash = { days: null, loading: false };
async function loadDash() {
  if (dash.loading) return; dash.loading = true;
  const dates = Array.from({ length: 14 }, (_, i) => addDays(S.dayDate, i - 13));
  const docs = await Promise.all(dates.map((d) => (d === S.dayDate ? Promise.resolve(S.day) : getDay(d).catch(() => emptyDay(d)))));
  dash = { days: docs.map((x, i) => ({ date: dates[i], doc: x || emptyDay(dates[i]) })), loading: false }; render();
}
function viewDashboard() {
  if (!dash.days) { loadDash(); return `<div class="page"><h1>Dashboard</h1><div class="kpis">${'<div class="card" style="height:96px"></div>'.repeat(4)}</div><p class="muted">Loading the last 14 days…</p></div>`; }
  const days = dash.days.map((x) => (x.date === S.dayDate ? { date: x.date, doc: S.day || x.doc } : x));
  const net = (d) => d.sales.reduce((a, s) => a + s.total, 0) - d.returns.reduce((a, r) => a + r.total, 0);
  const series = days.map((x) => ({ date: x.date, net: net(x.doc) }));
  const t = days[13].doc, y = days[12].doc; const tn = net(t), yn = net(y);
  const items = t.sales.reduce((a, s) => a + s.lines.reduce((b, l) => b + l.qty, 0), 0);
  const variants = Object.values(S.catalog?.variants || {}).filter((v) => !v.archived);
  const units = variants.reduce((a, v) => a + onHand(v.id), 0);
  const low = variants.filter((v) => onHand(v.id) <= v.low).sort((a, b) => onHand(a.id) - onHand(b.id));
  const relabel = variants.filter((v) => v.relabel).length;
  let cash = 0, card = 0; const top = {};
  for (const x of days.slice(7)) { for (const s of x.doc.sales) { if (s.payment.method === "cash") cash += s.total; else card += s.total; for (const l of s.lines) { top[l.desc] = (top[l.desc] || 0) + l.qty; } } for (const r of x.doc.returns) { if (r.method === "cash") cash -= r.total; else card -= r.total; } }
  const tops = Object.entries(top).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const recent = t.sales.slice().reverse().slice(0, 5);
  const change = yn ? Math.round(((tn - yn) / Math.abs(yn)) * 100) : null;
  const max = Math.max(1, ...series.map((s) => s.net)); const avg = series.reduce((a, s) => a + s.net, 0) / 14;
  const W = 640, H = 210, pb = 26, pt = 14, bw = W / 14; const yy = (v) => pt + (H - pt - pb) * (1 - Math.max(0, v) / max);
  const lab = (d) => new Date(d + "T12:00:00Z").toLocaleDateString("en-ZA", { day: "numeric", month: "short", timeZone: "UTC" });
  const chart = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto" role="img" aria-label="Net sales for the last 14 days; average ${rand(Math.round(avg))} a day">
    ${[0.5, 1].map((f) => `<line x1="0" x2="${W}" y1="${yy(max * f)}" y2="${yy(max * f)}" stroke="#E5E7EB"/>`).join("")}
    ${series.map((s, i) => { const x = i * bw + bw * 0.18, w = bw * 0.64, top = yy(s.net), today = i === 13; return `<rect x="${x}" y="${top}" width="${w}" height="${Math.max(0, H - pb - top)}" rx="6" fill="${today ? "#365314" : s.net > avg ? "#A3E635" : "#D9F99D"}"><title>${lab(s.date)}: ${rand(s.net)}</title></rect>${i % 2 === 1 || today ? `<text x="${x + w / 2}" y="${H - 8}" text-anchor="middle" font-size="11" fill="#647067">${today ? "Today" : lab(s.date)}</text>` : ""}`; }).join("")}
    <line x1="0" x2="${W}" y1="${yy(avg)}" y2="${yy(avg)}" stroke="#8A5A00" stroke-width="1.5" stroke-dasharray="6 5"/><text x="4" y="${yy(avg) - 6}" font-size="11" fill="#8A5A00">Daily average ${rand(Math.round(avg))}</text></svg>`;
  const share = cash + card > 0 ? Math.max(0, cash) / (Math.max(0, cash) + Math.max(0, card)) : 0; const C = 2 * Math.PI * 42;
  const kpi = (ic, l, v, s) => `<div class="card kpi"><span class="ic">${icon(ic)}</span><div><p class="small muted">${l}</p><p class="v">${v}</p>${s ? `<p class="small muted">${s}</p>` : ""}</div></div>`;
  return `<div class="page">
  <div class="row" style="justify-content:space-between"><div><h1>Dashboard</h1><p class="muted small">${longDate(S.dayDate)}</p></div><button class="btn primary lg" data-nav="till">${icon("till")} Open POS</button></div>
  ${S.settings?.isFixture ? `<div class="alert warn"><strong>Before launch:</strong> replace the placeholder business details in <button class="btn ghost" data-nav="settings">Settings</button></div>` : ""}
  <div class="kpis">${kpi("receipts", "Net sales today", rand(tn), change === null ? "No sales yesterday to compare" : `${change >= 0 ? "▲" : "▼"} ${Math.abs(change)}% vs yesterday`)}${kpi("till", "Sales today", t.sales.length, `${items} item${items === 1 ? "" : "s"} sold`)}${kpi("stock", "Stock on hand", units.toLocaleString("en-ZA"), `${variants.length} sizes for sale`)}${kpi("leaf", "Low stock", low.length, relabel ? `${relabel} shelf label${relabel === 1 ? "" : "s"} to replace` : "Shelf labels up to date")}</div>
  <div class="grid2" style="grid-template-columns:minmax(0,2fr) minmax(0,1fr)">
    <section class="card stack"><div class="row" style="justify-content:space-between"><h2>Net sales</h2><span class="pill" style="background:var(--forest);color:#fff">Last 14 days</span></div>${chart}</section>
    <section class="card stack"><h2>Payments · last 7 days</h2><div class="row" style="flex-wrap:nowrap"><svg viewBox="0 0 100 100" style="width:110px;flex-shrink:0" role="img" aria-label="Cash ${Math.round(share * 100)} percent"><circle cx="50" cy="50" r="42" fill="none" stroke="#ECFCCB" stroke-width="14"/>${cash + card > 0 ? `<circle cx="50" cy="50" r="42" fill="none" stroke="#365314" stroke-width="14" stroke-dasharray="${share * C} ${C}" transform="rotate(-90 50 50)"/>` : ""}<text x="50" y="55" text-anchor="middle" font-size="16" font-weight="600" fill="#17211B">${cash + card > 0 ? Math.round(share * 100) + "%" : "—"}</text></svg>
      <div class="small"><p>■ Cash <strong class="tab">${rand(cash)}</strong></p><p style="color:var(--muted)">■ Card <strong class="tab" style="color:var(--ink)">${rand(card)}</strong></p></div></div>
      <div class="row"><button class="btn" data-nav="receive">Receive stock</button><button class="btn" data-nav="labels">Print labels</button><button class="btn" data-nav="data">Import products</button></div></section>
  </div>
  <div class="grid2" style="grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr))">
    <section class="card stack"><h2>Top plants · 7 days</h2>${tops.length ? `<ol style="margin:0;padding-left:20px">${tops.map(([n, q]) => `<li class="row" style="justify-content:space-between;display:list-item"><span>${esc(n)}</span> <strong class="tab" style="float:right">${q}×</strong></li>`).join("")}</ol>` : `<p class="muted small">No sales yet this week.</p>`}</section>
    <section class="card stack"><div class="row" style="justify-content:space-between"><h2>Low stock</h2><button class="btn ghost" data-nav="stock">View all</button></div>${low.length ? low.slice(0, 6).map((v) => `<p class="row" style="justify-content:space-between"><span>${esc(label(v))}</span><span class="pill ${onHand(v.id) ? "warn" : "danger"}">${onHand(v.id) ? onHand(v.id) + " left" : "Sold out"}</span></p>`).join("") : `<p class="muted small">Nothing is low.</p>`}</section>
    <section class="card stack"><div class="row" style="justify-content:space-between"><h2>Recent sales</h2><button class="btn ghost" data-nav="receipts">All sales</button></div>${recent.length ? recent.map((s) => `<p class="row" style="justify-content:space-between"><button class="btn ghost" style="padding:0 6px" data-receipt="${S.dayDate}|${s.key}">${s.no}</button><span class="muted small">${dt(s.at)} · ${s.payment.method}</span><strong class="tab">${rand(s.total)}</strong></p>`).join("") : `<p class="muted small">No sales yet today.</p>`}</section>
  </div></div>`;
}
