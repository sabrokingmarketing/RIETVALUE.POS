"use client";
import { useActionState } from "react";
import type { Category } from "@/server/catalog";
import { Alert, Button, Card } from "@/components/ui";
import { createProductAction } from "../../actions";
import { ProductFields, VariantFields } from "../product-fields";

export function NewProductForm({ categories }: { categories: Category[] }) {
  const [state, action, pending] = useActionState(createProductAction, null);
  return (
    <form action={action} className="flex flex-col gap-6">
      {state && !state.ok && <Alert tone="error">{state.error}</Alert>}
      <Card className="p-5"><h2 className="mb-4 font-semibold">Plant details</h2><ProductFields categories={categories} /></Card>
      <Card className="p-5"><h2 className="mb-4 font-semibold">First size</h2><VariantFields /></Card>
      <div><Button type="submit" size="lg" busy={pending}>Save product</Button></div>
    </form>
  );
}
