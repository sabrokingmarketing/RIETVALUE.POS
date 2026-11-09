"use client";
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-[60dvh] max-w-lg flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="text-muted">Nothing you saved has been lost. Check the connection and try again.</p>
      <button type="button" onClick={reset} className="min-h-11 rounded-lg bg-forest px-4 font-semibold text-white">Try again</button>
    </main>
  );
}
