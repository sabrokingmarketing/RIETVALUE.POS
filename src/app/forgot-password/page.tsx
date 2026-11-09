"use client";
import { useState } from "react";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import { AuthShell } from "@/components/auth/auth-shell";
import { Alert, Button, Field, inputClass } from "@/components/ui";

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <AuthShell title="Reset your password" footer={<Link href="/login" className="text-forest underline">Back to sign-in</Link>}>
      {sent ? (
        <Alert tone="success" title="Check your e-mail">
          If that address belongs to a staff account, a reset link is on its way. It works for one hour.
          Cashiers can also ask the owner to set a new password from the Staff page.
        </Alert>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={async (e) => {
          e.preventDefault(); setBusy(true);
          const email = String(new FormData(e.currentTarget).get("email")).trim();
          await authClient.requestPasswordReset({ email, redirectTo: "/reset-password" }).catch(() => null);
          setSent(true); setBusy(false);
        }}>
          <p className="text-sm text-muted">Enter your staff e-mail address and we will send a link to choose a new password.</p>
          <Field label="E-mail" htmlFor="email"><input id="email" name="email" type="email" required autoComplete="username" className={inputClass} /></Field>
          <Button type="submit" busy={busy}>Send reset link</Button>
        </form>
      )}
    </AuthShell>
  );
}
