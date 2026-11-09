"use client";
import { useActionState } from "react";
import { Alert, Button, Field, inputClass } from "@/components/ui";
import { setupOwner } from "./actions";

export function SetupForm() {
  const [state, action, pending] = useActionState(setupOwner, null);
  return (
    <form action={action} className="flex flex-col gap-4">
      {state && !state.ok && <Alert tone="error">{state.error}</Alert>}
      <Field label="Setup code" htmlFor="setupToken"><input id="setupToken" name="setupToken" required autoComplete="off" className={inputClass} /></Field>
      <Field label="Your name" htmlFor="name"><input id="name" name="name" required autoComplete="name" className={inputClass} /></Field>
      <Field label="E-mail" htmlFor="email"><input id="email" name="email" type="email" required autoComplete="username" className={inputClass} /></Field>
      <Field label="Password" htmlFor="password" hint="At least 10 characters. You will use this to sign in and to authorise returns.">
        <input id="password" name="password" type="password" required minLength={10} autoComplete="new-password" className={inputClass} />
      </Field>
      <Button type="submit" busy={pending}>Create owner account</Button>
    </form>
  );
}
