import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";

export default function Forbidden() {
  return (
    <AuthShell title="Owner access only">
      <p className="text-muted">This page is for the owner. Ask the owner to sign in, or go back to the till.</p>
      <Link href="/till" className="mt-4 inline-flex min-h-11 items-center font-semibold text-forest underline">Back to the till</Link>
    </AuthShell>
  );
}
