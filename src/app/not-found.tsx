import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[60dvh] max-w-lg flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-3xl font-semibold">Page not found</h1>
      <p className="text-muted">That page does not exist or is no longer available.</p>
      <Link href="/" className="inline-flex min-h-11 items-center font-semibold text-forest underline">Go to the till</Link>
    </main>
  );
}
