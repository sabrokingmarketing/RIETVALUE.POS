"use client";
import { useActionState, useState, useTransition } from "react";
import { Dialog } from "@/components/dialog";
import { Alert, Button, Field, inputClass } from "@/components/ui";
import type { ActionState } from "@/server/http";
import { createStaffAction, setStaffActiveAction, setStaffPasswordAction } from "../actions";

export function AddStaffForm() {
  const [state, action, pending] = useActionState(createStaffAction, null);
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2" key={state?.ok ? "done" + Date.now() : "form"}>
      <Field label="Name" htmlFor="sname"><input id="sname" name="name" required maxLength={60} className={inputClass} /></Field>
      <Field label="E-mail (used to sign in)" htmlFor="semail"><input id="semail" name="email" type="email" required className={inputClass} autoComplete="off" /></Field>
      <Field label="Temporary password" htmlFor="spass" hint="At least 10 characters. Tell them in person."><input id="spass" name="password" type="text" required minLength={10} autoComplete="new-password" className={inputClass} /></Field>
      <Field label="Role" htmlFor="srole"><select id="srole" name="role" className={inputClass} defaultValue="cashier"><option value="cashier">Cashier</option><option value="owner">Owner</option></select></Field>
      <div className="sm:col-span-2">{state && (state.ok ? <Alert tone="success">{state.message}</Alert> : <Alert tone="error">{state.error}</Alert>)}</div>
      <div><Button type="submit" busy={pending}>Add staff member</Button></div>
    </form>
  );
}

export function StaffActions({ userId, name, active }: { userId: string; name: string; active: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<ActionState>(null);
  const [open, setOpen] = useState(false);
  const [pwState, pwAction, pwPending] = useActionState(setStaffPasswordAction.bind(null, userId), null);
  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => setOpen(true)}>Set new password</Button>
        <Button variant={active ? "danger" : "secondary"} busy={pending} onClick={() => {
          if (active && !confirm(`Deactivate ${name}? They are signed out immediately and cannot sign in. Their sales history is kept.`)) return;
          start(async () => setMsg(await setStaffActiveAction(userId, !active)));
        }}>{active ? "Deactivate" : "Reactivate"}</Button>
      </div>
      {msg && (msg.ok ? <p className="text-sm text-forest" role="status">{msg.message}</p> : <p className="text-sm text-danger" role="alert">{msg.error}</p>)}
      <Dialog open={open} onClose={() => setOpen(false)} title={`New password for ${name}`} labelledBy={`pw-${userId}`}>
        <form action={pwAction} className="flex flex-col gap-4">
          <Field label="New password" htmlFor={`np-${userId}`} hint="At least 10 characters. They will be signed out everywhere.">
            <input id={`np-${userId}`} name="password" type="text" required minLength={10} autoComplete="new-password" className={inputClass} />
          </Field>
          {pwState && (pwState.ok ? <Alert tone="success">{pwState.message}</Alert> : <Alert tone="error">{pwState.error}</Alert>)}
          <Button type="submit" busy={pwPending}>Save password</Button>
        </form>
      </Dialog>
    </div>
  );
}
