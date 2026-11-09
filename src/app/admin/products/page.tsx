import type { Metadata } from "next";
import Link from "next/link";
import { pageActor } from "@/server/session";
import { listProducts } from "@/server/catalog";
import { photoUrl } from "@/lib/photo";
import { Badge, Button, ButtonLink, EmptyState, PageHeader, Table, inputClass, td, th } from "@/components/ui";

export const metadata: Metadata = { title: "Plants & products" };

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ q?: string; archived?: string }> }) {
  await pageActor(["owner"], "/admin/products");
  const sp = await searchParams;
  const archived = sp.archived === "1";
  const rows = await listProducts({ term: sp.q?.slice(0, 60), archived });
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Plants & products" description="Each product has one or more sizes. Every size has its own price, SKU and barcode."
        actions={<ButtonLink href="/admin/products/new">Add a plant or product</ButtonLink>} />
      <form className="mb-4 flex flex-col gap-2 sm:flex-row" role="search">
        <label htmlFor="q" className="sr-only">Search products</label>
        <input id="q" name="q" defaultValue={sp.q} className={inputClass} placeholder="Search by name, SKU or barcode" />
        {archived && <input type="hidden" name="archived" value="1" />}
        <Button type="submit" variant="secondary">Search</Button>
        <Link href={archived ? "/admin/products" : "/admin/products?archived=1"} className="inline-flex min-h-11 items-center px-2 text-sm text-forest underline whitespace-nowrap">
          {archived ? "Show active" : "Show archived"}
        </Link>
      </form>
      {rows.length === 0 ? (
        <EmptyState title={archived ? "No archived products" : sp.q ? "Nothing matches your search" : "No products yet"}
          action={!archived && !sp.q ? <ButtonLink href="/admin/products/new">Add your first plant</ButtonLink> : undefined}>
          {!archived && !sp.q && "Start with one plant, receive its stock, print labels and sell it at the till."}
        </EmptyState>
      ) : (
        <Table>
          <thead><tr><th className={th}><span className="sr-only">Photo</span></th><th className={th}>Name</th><th className={th}>Category</th><th className={th}>Sizes</th><th className={th}>On hand</th><th className={th}>Flags</th></tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className="hover:bg-leaf">
                <td className={`${td} w-16`}>{photoUrl(p.photo_path) ? <img src={photoUrl(p.photo_path)!} alt="" className="size-12 rounded-lg object-cover" /> : <span className="block size-12 rounded-lg bg-mist" />}</td>
                <td className={td}><Link className="inline-flex min-h-11 flex-col justify-center font-semibold text-forest underline" href={`/admin/products/${p.id}`}>{p.common_name}</Link>
                  {p.botanical_name && <span className="block text-xs italic text-muted">{p.botanical_name}</span>}</td>
                <td className={td}>{p.category_name}</td>
                <td className={td}>{p.variant_count}</td>
                <td className={`${td} tabular`}>{p.on_hand}</td>
                <td className={td}><div className="flex flex-wrap gap-1">{p.low > 0 && <Badge tone="warn">{p.low} low</Badge>}{p.relabel > 0 && <Badge tone="warn">Relabel</Badge>}</div></td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
