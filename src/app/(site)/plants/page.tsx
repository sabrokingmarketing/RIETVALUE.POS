import type { Metadata } from "next";
import Link from "next/link";
import { publicCatalogue, publicCategories } from "@/server/public";
import { PlantCard } from "@/components/site/plant-card";
import { Button, inputClass } from "@/components/ui";

export const metadata: Metadata = { title: "Plants" };

export default async function PlantsPage({ searchParams }: { searchParams: Promise<{ c?: string; q?: string }> }) {
  const sp = await searchParams;
  const category = sp.c && /^[a-z0-9-]{1,60}$/.test(sp.c) ? sp.c : undefined;
  const term = (sp.q ?? "").slice(0, 60);
  const [plants, cats] = await Promise.all([publicCatalogue({ category, term }), publicCategories()]);
  const href = (c?: string) => `/plants${c || term ? "?" : ""}${new URLSearchParams({ ...(c ? { c } : {}), ...(term ? { q: term } : {}) })}`;
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-semibold sm:text-4xl">Plants</h1>
      <p className="mt-2 text-muted">Prices include VAT. Availability updates as we sell; message us to check before a long trip.</p>
      <form className="mt-6 flex max-w-xl gap-2" role="search">
        <label htmlFor="q" className="sr-only">Search plants</label>
        <input id="q" name="q" defaultValue={term} placeholder="Search plants" className={inputClass} />
        {category && <input type="hidden" name="c" value={category} />}
        <Button type="submit" variant="secondary">Search</Button>
      </form>
      <nav aria-label="Categories" className="mt-4 flex gap-2 overflow-x-auto pb-2">
        <Link href={href()} aria-current={!category ? "page" : undefined} className={`inline-flex min-h-11 items-center whitespace-nowrap rounded-full border px-4 text-sm font-medium ${!category ? "border-forest bg-leaf text-forest" : "border-line hover:bg-mist"}`}>All</Link>
        {cats.map((c) => (
          <Link key={c.slug} href={href(c.slug)} aria-current={category === c.slug ? "page" : undefined}
            className={`inline-flex min-h-11 items-center whitespace-nowrap rounded-full border px-4 text-sm font-medium ${category === c.slug ? "border-forest bg-leaf text-forest" : "border-line hover:bg-mist"}`}>{c.name}</Link>
        ))}
      </nav>
      {plants.length === 0 ? (
        <div className="mt-10 rounded-2xl bg-mist p-10 text-center">
          <p className="font-semibold">No plants match{term ? ` “${term}”` : ""}.</p>
          <Link href="/plants" className="mt-2 inline-flex min-h-11 items-center text-forest underline">Show all plants</Link>
        </div>
      ) : (
        <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{plants.map((p) => <PlantCard key={p.product_id} p={p} />)}</div>
      )}
    </div>
  );
}
