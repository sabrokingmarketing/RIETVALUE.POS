import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { LoginForm } from "@/components/auth/login-form";
import { Alert } from "@/components/ui";
import { getActor } from "@/server/session";
import { needsSetup } from "@/server/users";

export const metadata: Metadata = { title: "Staff sign-in", robots: { index: false } };
export const dynamic = "force-dynamic";

function safeNext(n: string | undefined) {
  return n && n.startsWith("/") && !n.startsWith("//") && !n.startsWith("/\\") ? n : "/till";
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; setup?: string; reset?: string }> }) {
  const sp = await searchParams;
  if (await needsSetup()) redirect("/setup");
  const actor = await getActor();
  if (actor) redirect(safeNext(sp.next));
  return (
    <AuthShell title="Staff sign-in">
      {sp.setup && <Alert tone="success" className="mb-4">Owner account created. Sign in to continue.</Alert>}
      {sp.reset && <Alert tone="success" className="mb-4">Password changed. Sign in with your new password.</Alert>}
      <LoginForm next={safeNext(sp.next)} />
    </AuthShell>
  );
}
