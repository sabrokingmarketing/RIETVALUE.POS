// ---------------------------------------------------------------- TILL
let posCat = null; let payPref = "cash";
function basketTotal() { return S.basket.reduce((s, l) => s + l.unitPrice * l.qty, 0); }
function viewTill() {
  const total = basketTotal(); const items = S.basket.reduce((s, l) => s + l.qty, 0);
  const last = S.basket.find((l) => l.id === S.lastId);
  const readOnly = !canSell();
  const all = Object.values(S.catalog?.variants || {}).filter((v) => !v.archived);
  const cats = [...new Set(all.map((v) => v.category))].sort().map((c) => [c, all.filter((v) => v.category === c).length]);
  const t = S.search.trim().toLowerCase();
  const grid = all.filter((v) => (!posCat || v.category === posCat) && (!t || (v.name + " " + (v.botanical || "") + " " + v.sku).toLowerCase().includes(t) || v.barcode === S.search.trim()))
    .sort((a, b) => a.name.localeCompare(b.name) || a.size.localeCompare(b.size));
  const blocked = !S.online || !S.till?.open || !!S.pending || readOnly;
  const bp = vatBp(); const vat = S.basket.reduce((s, l) => s + vatIn(l.unitPrice * l.qty, bp), 0);
  return `<div class="till">
  <div class="left">
    ${readOnly ? `<div class="alert warn"><strong>View only.</strong> Ask the owner to give you Contributor access to sell.</div>` : ""}
    ${!S.online ? `<div class="alert error"><strong>Offline — checkout is disabled.</strong> Keep the customer's plants aside and finish when the connection returns.</div>` : ""}
    ${!S.till?.open && !readOnly ? `<div class="alert warn"><strong>The till is not open.</strong> Count the opening float first. <button class="btn ghost" data-nav="cash">Open the till</button></div>` : ""}
    ${S.pending ? `<div class="alert warn stack"><p><strong>Connection lost while completing a sale.</strong> Checkout ${esc(S.pending.key.slice(0, 8).toUpperCase())} for <strong>${rand(S.pending.total)}</strong> (${S.pending.payment.method}). <strong>Do not take payment again.</strong></p>
      <div class="row"><button class="btn primary" data-act="recover">Check and finish sale</button><button class="btn" data-act="abandon">Customer was not charged — back to basket</button></div></div>` : ""}
    ${S.done ? doneCard() : ""}
    <form class="card stack" id="scanForm" autocomplete="off">
      <label class="f" for="scan" style="font-size:.9rem;font-weight:600">Scan barcode</label>
      <div class="row" style="flex-wrap:nowrap"><input id="scan" class="i scan" placeholder="Scan or type code" inputmode="text" spellcheck="false" ${S.pending || readOnly ? "disabled" : ""}><button class="btn lg" type="submit" ${S.pending || readOnly ? "disabled" : ""}>Add</button></div>
      <p class="small muted">Each scan adds one item. Scan the same pot twice to sell two.</p>
      <div aria-live="polite">${last ? `<div class="last"><div><p class="small muted" style="text-transform:uppercase;letter-spacing:.06em">Last item</p><p style="font-weight:600">${esc(last.name)} — ${esc(last.size)}</p></div><p style="text-align:right"><span class="small muted">Qty in order</span><br><span class="tab" style="font-size:1.6rem;font-weight:700">${last.qty}</span></p></div>` : ""}</div>
      ${S.msg ? `<div class="alert ${S.msg.tone === "error" ? "error" : S.msg.tone === "ok" ? "ok" : "warn"}" role="alert">${esc(S.msg.text)}</div>` : ""}
    </form>
    <section class="stack" aria-labelledby="cat-h"><h2 id="cat-h">Category</h2>
      <div class="chips" role="group" aria-label="Filter products by category">
        <button class="chip" data-cat="" aria-pressed="${!posCat}"><span class="dot">${icon("leaf")}</span>All plants <span class="small muted">${all.length}</span></button>
        ${cats.map(([c, n]) => `<button class="chip" data-cat="${esc(c)}" aria-pressed="${posCat === c}"><span class="dot">${icon("leaf")}</span>${esc(c)} <span class="small muted">${n}</span></button>`).join("")}
      </div></section>
    <section class="stack" aria-labelledby="prod-h">
      <div class="row" style="justify-content:space-between"><h2 id="prod-h">Products</h2><label class="sr" for="tsearch">Find by name or SKU</label><input id="tsearch" class="i" type="search" style="max-width:280px" placeholder="Find by name or SKU" value="${esc(S.search)}" autocomplete="off"></div>
      ${grid.length ? `<ul class="pgrid" style="list-style:none;margin:0;padding:0">${grid.map((v) => { const n = onHand(v.id); const inB = S.basket.find((l) => l.id === v.id)?.qty || 0; return `<li class="pcard ${inB ? "inbasket" : ""}">
        <div class="pimg">${icon("leaf", "ico")}${n <= 0 ? `<span class="pill danger">Sold out</span>` : n <= v.low ? `<span class="pill warn">${n} left</span>` : ""}${inB ? `<span class="pill r">${inB} in order</span>` : ""}</div>
        <div class="pbody"><strong style="line-height:1.25">${esc(v.name)}</strong><span class="small muted">${esc(v.size)}</span><span class="tab" style="font-size:1.1rem;font-weight:700;margin-top:auto;padding-top:4px">${rand(v.price)}</span>
        <button class="addbtn" data-add="${v.id}" aria-label="Add ${esc(v.name)} ${esc(v.size)} to order" ${S.pending || readOnly ? "disabled" : ""}>+ Add</button></div></li>`; }).join("")}</ul>`
      : `<div class="empty"><p style="font-weight:600">${t ? `Nothing matches “${esc(S.search)}”` : all.length ? "No products in this category" : "No products yet"}</p><p class="muted small">${all.length ? "Try another name or category, or scan the label." : "The owner adds plants under Products or Import/Export."}</p></div>`}
    </section>
  </div>
  <aside aria-label="Order" style="display:flex;flex-direction:column">
    <div class="row" style="justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--line)"><h2>Order <span class="pill green">${items} item${items === 1 ? "" : "s"}</span></h2><button class="btn ghost" data-act="clear" ${!S.basket.length || S.pending ? "disabled" : ""}>Clear all</button></div>
    <div class="basket" style="flex:1;overflow-y:auto">${S.basket.length ? S.basket.map(lineHtml).join("") : `<div style="padding:32px;text-align:center"><p style="font-weight:600">The order is empty</p><p class="muted small">Scan a label or tap a product to start a sale.</p></div>`}</div>
    <div class="due">
      ${bp ? `<div class="row small muted" style="justify-content:space-between"><span>VAT included (${bp / 100}%)</span><span class="tab">${rand(vat)}</span></div>` : ""}
      <div class="row" style="justify-content:space-between;align-items:flex-end"><span class="small muted" style="font-weight:600;letter-spacing:.06em;text-transform:uppercase">Total</span><span class="amt" id="amountDue">${rand(total)}</span></div>
      <div class="paypref" role="group" aria-label="Payment method"><button data-paypref="cash" aria-pressed="${payPref === "cash"}">Pay by cash</button><button data-paypref="card" aria-pressed="${payPref === "card"}">Pay by card</button></div>
      <button class="btn primary xl" style="margin-top:10px" data-act="pay" ${blocked || !S.basket.length ? "disabled" : ""}>${S.online ? "Take payment" : "Offline — checkout disabled"}</button></div>
  </aside></div>`;
}
