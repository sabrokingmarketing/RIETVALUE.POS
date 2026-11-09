import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { needsSetup } from "@/server/users";
import { SetupForm } from "./setup-form";

export const metadata: Metadata = { title: "First-time setup", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function SetupPage() {
  if (!(await needsSetup())) redirect("/login");
  return (
    <AuthShell title="Create the owner account">
      <p className="mb-4 text-sm text-muted">This page only works once, before any owner exists. You need the setup code (<code>SETUP_TOKEN</code>) from the server configuration.</p>
      <SetupForm />
    </AuthShell>
  );
}
