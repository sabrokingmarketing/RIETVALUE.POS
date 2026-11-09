"use client";
import { useActionState, useState } from "react";
import { Dialog } from "@/components/dialog";
import { Alert, Button, Field, cx, inputClass } from "@/components/ui";
import { adjustStockAction } from "../actions";

export function AdjustButton({ variantId, label, onHand }: { variantId: number; label: string; onHand: number }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<"damage" | "plant_loss" | "count_correction">("count_correction");
  const [state, action, pending] = useActionState(adjustStockAction.bind(null, variantId), null);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>Adjust</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Adjust stock" labelledBy={`adj-${variantId}`}>
        <p className="mb-4 text-sm"><strong>{label}</strong> · <span className="tabular">{onHand}</span> on record</p>
        {state?.ok && state.data ? (
          <Alert tone="success">Saved. Stock is now {state.data.onHand} ({state.data.delta > 0 ? "+" : ""}{state.data.delta}).</Alert>
        ) : (
          <form action={action} className="flex flex-col gap-4">
            <Field label="Reason" htmlFor={`r-${variantId}`}>
              <select id={`r-${variantId}`} name="reason" value={reason} onChange={(e) => setReason(e.target.value as typeof reason)} className={inputClass}>
                <option value="count_correction">Count correction (I counted the actual number)</option>
                <option value="damage">Damaged — remove from stock</option>
                <option value="plant_loss">Plant loss (died, frost, pests)</option>
              </select>
            </Field>
            {reason === "count_correction"
              ? <Field label="Actual number counted" htmlFor={`c-${variantId}`}><input id={`c-${variantId}`} name="counted" type="number" min={0} required className={cx(inputClass, "tabular text-lg")} /></Field>
              : <Field label="How many to remove" htmlFor={`qq-${variantId}`}><input id={`qq-${variantId}`} name="quantity" type="number" min={1} max={onHand} required className={cx(inputClass, "tabular text-lg")} /></Field>}
            <Field label="What happened" htmlFor={`n-${variantId}`}><input id={`n-${variantId}`} name="note" required minLength={3} maxLength={500} className={inputClass} /></Field>
            {state && !state.ok && <Alert tone="error">{state.error}</Alert>}
            <Button type="submit" busy={pending}>Save adjustment</Button>
          </form>
        )}
      </Dialog>
    </>
  );
}
