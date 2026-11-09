"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import { AuthShell } from "@/components/auth/auth-shell";
import { Alert, Button, Field, inputClass } from "@/components/ui";

function ResetForm() {
  const token = useSearchParams().get("token") ?? "";
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!token) return <Alert tone="error">This reset link is incomplete or has expired. <Link className="underline" href="/forgot-password">Request a new one</Link>.</Alert>;
  return (
    <form className="flex flex-col gap-4" onSubmit={async (e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      const pw = String(f.get("password")), again = String(f.get("again"));
      if (pw.length < 10) return setError("Use at least 10 characters.");
      if (pw !== again) return setError("The two passwords do not match.");
      setBusy(true); setError(null);
      const { error } = await authClient.resetPassword({ newPassword: pw, token });
      if (error) { setError("This reset link is invalid or has expired. Request a new one."); setBusy(false); return; }
      window.location.href = "/login?reset=1";
    }}>
      {error && <Alert tone="error">{error}</Alert>}
      <Field label="New password" htmlFor="password" hint="At least 10 characters."><input id="password" name="password" type="password" autoComplete="new-password" required className={inputClass} /></Field>
      <Field label="Type it again" htmlFor="again"><input id="again" name="again" type="password" autoComplete="new-password" required className={inputClass} /></Field>
      <Button type="submit" busy={busy}>Save new password</Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <AuthShell title="Choose a new password">
      <Suspense fallback={null}><ResetForm /></Suspense>
    </AuthShell>
  );
}
