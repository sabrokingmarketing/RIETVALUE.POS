"use client";
import { useActionState } from "react";
import Link from "next/link";
import { Alert, Button, Field, inputClass, cx } from "@/components/ui";
import { formatRand } from "@/lib/money";
import { openTillAction, closeTillAction } from "../actions";

export function OpenTillForm() {
  const [state, action, pending] = useActionState(openTillAction, null);
  if (state?.ok) return <Alert tone="success" title="Till opened">You can start selling. <Link className="font-semibold underline" href="/till">Go to the till</Link></Alert>;
  return (
    <form action={action} className="flex flex-col gap-4">
      {state && !state.ok && <Alert tone="error">{state.error}</Alert>}
      <Field label="Opening float (R)" htmlFor="float" hint="The cash in the drawer before trading starts.">
        <input id="float" name="float" inputMode="decimal" required className={cx(inputClass, "tabular min-h-14 text-2xl font-bold")} placeholder="500.00" autoFocus />
      </Field>
      <Button type="submit" size="lg" busy={pending}>Open the till</Button>
    </form>
  );
}

export function TillResult({ expectedCents, countedCents, varianceCents: v }: { expectedCents: number; countedCents: number; varianceCents: number }) {
  return (
    <div className="mb-6" data-testid="till-closed">
      <Alert tone={v === 0 ? "success" : "warn"} title={v === 0 ? "The till balances" : v > 0 ? "Cash over" : "Cash short"}>
        <dl className="tabular mt-2 grid grid-cols-2 gap-x-6 gap-y-1">
          <dt>Expected cash</dt><dd className="text-right font-semibold">{formatRand(expectedCents)}</dd>
          <dt>Counted cash</dt><dd className="text-right font-semibold">{formatRand(countedCents)}</dd>
          <dt>Variance</dt><dd className="text-right font-bold" data-testid="variance">{v > 0 ? "+" : ""}{formatRand(v)}</dd>
        </dl>
      </Alert>
    </div>
  );
}

export function CloseTillForm() {
  const [state, action, pending] = useActionState(closeTillAction, null);
  const needsNote = state && !state.ok && (state.details as { variance?: number } | undefined)?.variance !== undefined;
  return (
    <form action={action} className="mt-4 flex flex-col gap-4">
      {state && !state.ok && <Alert tone="error">{state.error}</Alert>}
      <Field label="Counted cash in drawer (R)" htmlFor="counted">
        <input id="counted" name="counted" inputMode="decimal" required className={cx(inputClass, "tabular min-h-14 text-2xl font-bold")} placeholder="0.00" />
      </Field>
      <Field label={needsNote ? "Explain the difference (required)" : "Note (needed if the count does not match)"} htmlFor="note">
        <textarea id="note" name="note" rows={2} className={cx(inputClass, "py-2")} maxLength={500} />
      </Field>
      <Button type="submit" size="lg" busy={pending}>Close the till</Button>
    </form>
  );
}
