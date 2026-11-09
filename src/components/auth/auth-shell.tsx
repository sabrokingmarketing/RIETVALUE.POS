import { Sprout } from "lucide-react";

export function AuthShell({ title, children, footer }: { title: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <div className="w-full max-w-md">
        <p className="mb-6 flex items-center justify-center gap-2 font-semibold text-forest"><Sprout className="size-6" aria-hidden /> Rietvalei POS</p>
        <section className="rounded-2xl border border-line bg-surface p-6 shadow-sm">
          <h1 className="mb-5 text-2xl font-semibold">{title}</h1>
          {children}
        </section>
        {footer && <div className="mt-4 text-center text-sm">{footer}</div>}
      </div>
    </main>
  );
}
