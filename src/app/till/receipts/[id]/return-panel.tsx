"use client";
import { uuid } from "@/lib/uuid";
import { useMemo, useState } from "react";
import { Alert, Button, Card, Field, cx, inputClass } from "@/components/ui";
import { formatRand } from "@/lib/money";
import type { Receipt } from "@/server/receipts";
import { returnAction } from "../../actions";

type Row = { qty: number; condition: "resellable" | "damaged" };

export function ReturnPanel({ receipt, isOwner }: { receipt: Receipt; isOwner: boolean }) {
  const [rows, setRows] = useState<Record<number, Row>>({});
  const [reason, setReason] = useState("");
  const [method, setMethod] = useState<"cash" | "card">(receipt.payment.method);
  const [reference, setReference] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [ownerEmail, setOwnerEmail] = useState("");
  const [ownerPassword, setOwnerPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ returnId: number; returnNo: string; totalCents: number } | null>(null);
  const [key] = useState(() => uuid());

  const total = useMemo(() => receipt.lines.reduce((s, l) => s + (rows[l.id]?.qty ?? 0) * l.unit_price_cents, 0), [rows, receipt.lines]);

  if (done) {
    return (
      <Alert tone="success" title={`Return ${done.returnNo} recorded`} className="mt-3">
        <p>Refund of <strong className="tabular">{formatRand(done.totalCents)}</strong> by {method}. Resellable items are back in stock.</p>
        <a className="mt-2 inline-flex min-h-11 items-center font-semibold underline" href={`/print/return/${done.returnId}?auto=1`} target="_blank" rel="noopener">Print return slip</a>
      </Alert>
    );
  }

  const submit = async () => {
    setError(null);
    const lines = receipt.lines.filter((l) => (rows[l.id]?.qty ?? 0) > 0).map((l) => ({ saleLineId: l.id, quantity: rows[l.id].qty, condition: rows[l.id].condition }));
    if (!lines.length) return setError("Choose how many of each item are coming back.");
    setBusy(true);
    const res = await returnAction({
      idempotencyKey: key, saleId: receipt.id, reason, refundMethod: method, refundConfirmed: confirmed as true, refundReference: reference, lines,
      ownerApproval: isOwner ? undefined : { email: ownerEmail, password: ownerPassword },
    }).catch(() => ({ ok: false as const, error: "No connection. Nothing was recorded — try again." }));
    setBusy(false);
    if (res?.ok && res.data) setDone(res.data);
    else if (res && !res.ok) setError(res.error);
  };

  return (
    <Card className="mt-3 p-4">
      <p className="text-sm text-muted">The original sale is never changed. Only resellable items go back into stock.</p>
      <ul className="mt-3 divide-y divide-line">
        {receipt.lines.map((l) => {
          const left = l.quantity - l.returned_qty;
          const row = rows[l.id] ?? { qty: 0, condition: "resellable" as const };
          return (
            <li key={l.id} className={cx("py-3", row.qty > 0 && "bg-leaf/60")}>
              <p className="font-medium">{l.description}</p>
              <p className="text-xs text-muted">{l.quantity} sold at {formatRand(l.unit_price_cents)}{l.returned_qty ? ` · ${l.returned_qty} already returned` : ""}</p>
              {left > 0 ? (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <Field label={`Quantity back (max ${left})`} htmlFor={`rq-${l.id}`}>
                    <input id={`rq-${l.id}`} type="number" min={0} max={left} value={row.qty} inputMode="numeric" className={inputClass}
                      onChange={(e) => setRows({ ...rows, [l.id]: { ...row, qty: Math.max(0, Math.min(left, Math.floor(Number(e.target.value) || 0))) } })} />
                  </Field>
                  <Field label="Condition" htmlFor={`rc-${l.id}`}>
                    <select id={`rc-${l.id}`} value={row.condition} className={inputClass}
                      onChange={(e) => setRows({ ...rows, [l.id]: { ...row, condition: e.target.value as Row["condition"] } })}>
                      <option value="resellable">Resellable — back to stock</option>
                      <option value="damaged">Damaged — do not restock</option>
                    </select>
                  </Field>
                </div>
              ) : <p className="mt-1 text-sm text-muted">Fully returned.</p>}
            </li>
          );
        })}
      </ul>
      <div className="mt-3 grid gap-3">
        <Field label="Reason" htmlFor="reason"><input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass} placeholder="e.g. wrong size, plant died within a week" /></Field>
        <Field label="Refund method" htmlFor="method">
          <select id="method" value={method} onChange={(e) => setMethod(e.target.value as "cash" | "card")} className={inputClass}>
            <option value="cash">Cash from the till</option><option value="card">Card refund on the terminal</option>
          </select>
        </Field>
        {method === "card" && <Field label="Terminal refund reference (optional)" htmlFor="rref"><input id="rref" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={40} className={inputClass} /></Field>}
        {!isOwner && (
          <fieldset className="rounded-lg border border-line p-3">
            <legend className="px-1 text-sm font-semibold">Owner authorisation</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="Owner e-mail" htmlFor="oe"><input id="oe" type="email" autoComplete="off" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} className={inputClass} /></Field>
              <Field label="Owner password" htmlFor="op"><input id="op" type="password" autoComplete="off" value={ownerPassword} onChange={(e) => setOwnerPassword(e.target.value)} className={inputClass} /></Field>
            </div>
          </fieldset>
        )}
        <div className="flex items-center justify-between rounded-lg bg-mist p-3"><span className="font-semibold">Refund total</span><span className="tabular text-2xl font-bold">{formatRand(total)}</span></div>
        <label className="flex min-h-11 items-start gap-3 text-sm">
          <input type="checkbox" className="mt-1 size-5 accent-forest" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          <span>{method === "cash" ? `I have given the customer ${formatRand(total)} in cash.` : `The card terminal approved a refund of ${formatRand(total)}.`}</span>
        </label>
        {error && <Alert tone="error">{error}</Alert>}
        <Button onClick={submit} busy={busy} disabled={!confirmed || total === 0}>Record return</Button>
      </div>
    </Card>
  );
}
