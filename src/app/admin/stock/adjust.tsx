"use client";
import { useActionState, useState } from "react";
import { ArrowRight, Boxes, ClipboardCheck, Minus, Plus, Snowflake, TriangleAlert } from "lucide-react";
import { Dialog } from "@/components/dialog";
import { Alert, Button, cx, inputClass } from "@/components/ui";
import { adjustStockAction } from "../actions";

type Reason = "count_correction" | "damage" | "plant_loss";
const REASONS: { key: Reason; title: string; text: string; Icon: typeof Boxes; placeholder: string }[] = [
  { key: "count_correction", title: "Count correction", text: "I counted the actual number", Icon: ClipboardCheck, placeholder: "e.g. found 2 more behind the tunnel" },
  { key: "damage", title: "Damaged", text: "Broken pot, crushed plant", Icon: TriangleAlert, placeholder: "e.g. pot cracked when moving the table" },
  { key: "plant_loss", title: "Plant loss", text: "Died, frost, pests", Icon: Snowflake, placeholder: "e.g. frost damage overnight" },
];

export function AdjustButton({ variantId, label, onHand }: { variantId: number; label: string; onHand: number }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<Reason>("count_correction");
  const [qty, setQty] = useState<number>(onHand);
  const [state, action, pending] = useActionState(adjustStockAction.bind(null, variantId), null);
  const counting = reason === "count_correction";
  const after = counting ? qty : onHand - qty;
  const delta = after - onHand;
  const invalid = counting ? qty < 0 : qty < 1 || qty > onHand;
  const pick = (r: Reason) => { setReason(r); setQty(r === "count_correction" ? onHand : Math.min(1, onHand)); };
  const formId = `adj-form-${variantId}`;
  const done = state?.ok && state.data;
  return (
    <>
      <Button variant="secondary" onClick={() => { pick("count_correction"); setOpen(true); }}>Adjust</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Adjust stock" labelledBy={`adj-${variantId}`}
        icon={<Boxes className="size-5" />} description={<><strong className="text-ink">{label}</strong> · <span className="tabular">{onHand}</span> on record</>}
        footer={done ? <Button onClick={() => setOpen(false)}>Done</Button> : <>
          <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
          <Button type="submit" form={formId} busy={pending} disabled={invalid || delta === 0}>Save adjustment</Button>
        </>}>
        {done ? (
          <Alert tone="success" title="Stock updated">Now {state.data!.onHand} on hand ({state.data!.delta > 0 ? "+" : ""}{state.data!.delta}). The change is recorded in the stock history.</Alert>
        ) : (
          <form id={formId} action={action} className="flex flex-col gap-5">
            <fieldset>
              <legend className="mb-2 text-sm font-semibold">Why are you adjusting?</legend>
              <div className="grid gap-2 sm:grid-cols-3">
                {REASONS.map(({ key, title, text, Icon }) => {
                  const on = reason === key; const disabled = key !== "count_correction" && onHand === 0;
                  return (
                    <label key={key} className={cx("relative flex min-h-24 cursor-pointer flex-col gap-1.5 rounded-2xl border p-3 transition-colors has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-deep",
                      on ? "border-deep bg-soft" : "border-line hover:border-deep/30 hover:bg-mist", disabled && "cursor-not-allowed opacity-50")}>
                      <input type="radio" name="reason" value={key} checked={on} disabled={disabled} onChange={() => pick(key)} className="sr-only" />
                      <span className={cx("inline-flex size-9 items-center justify-center rounded-xl", on ? "bg-deep text-white" : "bg-mist text-deep")} aria-hidden><Icon className="size-4" /></span>
                      <span className="text-sm font-semibold leading-tight">{title}</span>
                      <span className="text-xs text-muted">{text}</span>
                      {on && <span className="absolute right-3 top-3 size-2.5 rounded-full bg-deep" aria-hidden />}
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <div>
              <label htmlFor={`q-${variantId}`} className="text-sm font-semibold">{counting ? "Actual number counted" : "How many to remove"}</label>
              <div className="mt-2 flex items-center gap-2">
                <button type="button" onClick={() => setQty((x) => Math.max(counting ? 0 : 1, x - 1))} aria-label="One fewer"
                  className="inline-flex size-12 items-center justify-center rounded-xl border border-field/60 hover:bg-soft"><Minus className="size-5" aria-hidden /></button>
                <input id={`q-${variantId}`} name={counting ? "counted" : "quantity"} type="number" inputMode="numeric" min={counting ? 0 : 1} max={counting ? undefined : onHand}
                  value={Number.isFinite(qty) ? qty : ""} onChange={(e) => setQty(Math.max(0, Math.floor(Number(e.target.value) || 0)))} required
                  className="tabular h-12 w-28 rounded-xl border border-field bg-surface text-center text-2xl font-bold" />
                <button type="button" onClick={() => setQty((x) => (counting ? x + 1 : Math.min(onHand, x + 1)))} aria-label="One more"
                  className="inline-flex size-12 items-center justify-center rounded-xl border border-field/60 hover:bg-soft"><Plus className="size-5" aria-hidden /></button>
              </div>
              <div className="mt-3 flex items-center gap-3 rounded-2xl bg-mist px-4 py-3" aria-live="polite">
                <span className="text-sm text-muted">On record</span><span className="tabular text-lg font-semibold">{onHand}</span>
                <ArrowRight className="size-4 text-muted" aria-hidden />
                <span className="text-sm text-muted">After saving</span><span className={cx("tabular text-lg font-semibold", after < 0 && "text-danger")}>{after}</span>
                <span className={cx("ml-auto rounded-full px-2.5 py-0.5 text-sm font-semibold tabular", delta > 0 ? "bg-soft text-deep" : delta < 0 ? "bg-warn-bg text-warn" : "bg-surface text-muted ring-1 ring-line")}>
                  {delta > 0 ? "+" : ""}{delta === 0 ? "No change" : delta}</span>
              </div>
              {!counting && qty > onHand && <p className="mt-2 text-sm text-danger">Only {onHand} on record.</p>}
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor={`n-${variantId}`} className="text-sm font-semibold">What happened?</label>
              <textarea id={`n-${variantId}`} name="note" required minLength={3} maxLength={500} rows={2}
                placeholder={REASONS.find((r) => r.key === reason)!.placeholder} className={cx(inputClass, "py-2.5")} />
              <p className="text-xs text-muted">Saved with your name and the time in the stock history.</p>
            </div>
            {state && !state.ok && <Alert tone="error">{state.error}</Alert>}
          </form>
        )}
      </Dialog>
    </>
  );
}
