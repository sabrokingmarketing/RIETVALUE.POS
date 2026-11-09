"use client";
import { useState } from "react";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import { Alert, Button, Field, inputClass } from "@/components/ui";

export function LoginForm({ next }: { next: string }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setBusy(true); setError(null);
        try {
          const { error } = await authClient.signIn.email({ email: String(f.get("email")).trim(), password: String(f.get("password")) });
          if (error) {
            setError(error.status === 429 ? "Too many attempts. Wait a minute and try again."
              : "Sign-in failed. Check your e-mail and password. If your account was deactivated, ask the owner.");
            setBusy(false);
            return;
          }
          window.location.href = next;
        } catch {
          setError("Could not reach the server. Check the internet connection.");
          setBusy(false);
        }
      }}
      className="flex flex-col gap-4"
    >
      {error && <Alert tone="error">{error}</Alert>}
      <Field label="E-mail" htmlFor="email"><input id="email" name="email" type="email" autoComplete="username" required className={inputClass} /></Field>
      <Field label="Password" htmlFor="password"><input id="password" name="password" type="password" autoComplete="current-password" required className={inputClass} /></Field>
      <Button type="submit" size="lg" busy={busy}>Sign in</Button>
      <Link href="/forgot-password" className="text-center text-sm text-forest underline">Forgot your password?</Link>
    </form>
  );
}
