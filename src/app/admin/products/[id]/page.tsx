import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { pageActor } from "@/server/session";
import { getProduct, listCategories } from "@/server/catalog";
import { photoUrl } from "@/lib/photo";
import { Alert, Badge, Card, PageHeader } from "@/components/ui";
import { EditProductForm, VariantCard, AddVariantForm, ArchiveProductButton } from "./forms";

export const metadata: Metadata = { title: "Edit product" };

export default async function ProductPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const { id } = await params;
  await pageActor(["owner"], `/admin/products/${id}`);
  const n = Number(id);
  const p = Number.isInteger(n) && n > 0 ? await getProduct(n) : null;
  if (!p) notFound();
  const categories = await listCategories();
  const created = (await searchParams).created;
  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/admin/products" className="text-sm text-forest underline">← All products</Link>
      <PageHeader title={p.common_name} description={p.botanical_name ? <i>{p.botanical_name}</i> : undefined}
        actions={<>{p.archived && <Badge tone="warn">Archived</Badge>}<ArchiveProductButton id={p.id} archived={p.archived} /></>} />
      {created && <Alert tone="success" className="mb-4" title="Product created">Next: <Link className="font-semibold underline" href="/admin/receive">receive stock</Link> and print its labels.</Alert>}
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card className="p-5"><h2 className="mb-4 font-semibold">Details</h2><EditProductForm product={p} categories={categories} /></Card>
        <Card className="p-5">
          <h2 className="mb-3 font-semibold">Photo</h2>
          {photoUrl(p.photo_path) ? <img src={photoUrl(p.photo_path)!} alt={p.common_name} className="aspect-[5/4] w-full rounded-lg object-cover" /> : <p className="text-sm text-muted">No photo yet. Add one in the details form.</p>}
          {p.photo_is_fixture && <p className="mt-2 text-xs text-warn">Placeholder illustration (development fixture). Replace with your own photo.</p>}
        </Card>
      </div>
      <h2 className="mt-8 mb-3 text-xl font-semibold">Sizes</h2>
      <div className="flex flex-col gap-4">
        {p.variants.map((v) => <VariantCard key={v.id} v={v} />)}
        <Card className="p-5"><h3 className="mb-4 font-semibold">Add another size</h3><AddVariantForm productId={p.id} /></Card>
      </div>
    </div>
  );
}
