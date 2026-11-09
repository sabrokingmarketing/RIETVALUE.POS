function lineHtml(l) {
  const issue = S.issues[l.id]; const v = V(l.id);
  return `<div class="bline ${issue ? "bad" : l.id === S.lastId ? "hl" : ""}">
    <div class="row" style="justify-content:space-between;align-items:flex-start;flex-wrap:nowrap"><div style="min-width:0"><p style="font-weight:600">${esc(l.name)}</p><p class="small muted">${esc(l.size)} · <span class="tab">${rand(l.unitPrice)}</span> each</p></div><p class="tab" style="font-size:1.15rem;font-weight:700">${rand(l.unitPrice * l.qty)}</p></div>
    <div class="row" style="justify-content:space-between;margin-top:8px">
      <div class="row" style="gap:4px"><button class="qtybtn" data-dec="${l.id}" aria-label="One fewer ${esc(l.name)}" ${l.qty <= 1 || S.pending ? "disabled" : ""}>−</button>
      <input class="qty tab" id="q-${l.id}" data-qty="${l.id}" type="number" inputmode="numeric" min="1" max="999" value="${l.qty}" aria-label="Quantity of ${esc(l.name)}" ${S.pending ? "disabled" : ""}>
      <button class="qtybtn" data-inc="${l.id}" aria-label="One more ${esc(l.name)}" ${S.pending ? "disabled" : ""}>+</button></div>
      <button class="btn ghost" style="color:var(--danger)" data-rm="${l.id}" ${S.pending ? "disabled" : ""}>Remove</button></div>
    ${issue ? `<p class="small" style="color:var(--danger);font-weight:600;margin-top:6px">${esc(issue)}</p>` : v && l.qty > onHand(l.id) ? `<p class="small" style="color:var(--warn);margin-top:6px">Stock record shows ${onHand(l.id)}. Checkout will be refused unless the owner corrects the count.</p>` : ""}
  </div>`;
}
