import type { Metadata } from "next";
import { pageActor } from "@/server/session";
import { listCategories } from "@/server/catalog";
import { PageHeader } from "@/components/ui";
import { NewProductForm } from "./form";

export const metadata: Metadata = { title: "Add a plant" };

export default async function NewProductPage() {
  await pageActor(["owner"], "/admin/products/new");
  const categories = await listCategories();
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Add a plant or product" description="Add the first size now; you can add more sizes afterwards. A barcode is created automatically." />
      <NewProductForm categories={categories} />
    </div>
  );
}
