"use client";
import { useActionState, useState, useTransition } from "react";
import Link from "next/link";
import type { Category, ProductDetail } from "@/server/catalog";
import { Alert, Badge, Button, Card, Field, cx, inputClass } from "@/components/ui";
import { formatRand } from "@/lib/money";
import { addAliasAction, createVariantAction, retireAliasAction, setProductArchivedAction, setVariantArchivedAction, updateProductAction, updateVariantAction } from "../../actions";
import { ProductFields, VariantFields } from "../product-fields";
import type { ActionState } from "@/server/http";

function Result({ state }: { state: ActionState }) {
  if (!state) return null;
  return state.ok ? <Alert tone="success">{state.message}</Alert> : <Alert tone="error">{state.error}</Alert>;
}

export function EditProductForm({ product, categories }: { product: ProductDetail; categories: Category[] }) {
  const [state, action, pending] = useActionState(updateProductAction.bind(null, product.id), null);
  return (
    <form action={action} className="flex flex-col gap-4">
      <ProductFields categories={categories} p={product} />
      <Result state={state} />
      <div><Button type="submit" busy={pending}>Save details</Button></div>
    </form>
  );
}

export function ArchiveProductButton({ id, archived }: { id: number; archived: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<ActionState>(null);
  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant={archived ? "secondary" : "danger"} busy={pending} onClick={() => {
        if (!archived && !confirm("Archive this product? It disappears from the till and website. Sales history is kept.")) return;
        start(async () => setMsg(await setProductArchivedAction(id, !archived)));
      }}>{archived ? "Restore product" : "Archive product"}</Button>
      {msg && !msg.ok && <p className="text-sm text-danger">{msg.error}</p>}
    </div>
  );
}

export function VariantCard({ v }: { v: ProductDetail["variants"][number] }) {
  const [state, action, pending] = useActionState(updateVariantAction.bind(null, v.id), null);
  const [aliasState, aliasAction, aliasPending] = useActionState(addAliasAction.bind(null, v.id), null);
  const [archPending, start] = useTransition();
  const [archMsg, setArchMsg] = useState<ActionState>(null);
  return (
    <Card className={cx("p-5", v.archived && "opacity-75")}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold">{v.size_label} <span className="tabular ml-2 text-muted">{formatRand(v.price_cents)}</span></h3>
          <p className="text-sm text-muted">Barcode <span className="font-mono font-semibold text-ink">{v.barcode}</span> · SKU <span className="font-mono">{v.sku}</span> · <span className="tabular">{v.on_hand}</span> in stock</p>
        </div>
        <div className="flex flex-wrap gap-1">
          {v.archived && <Badge tone="warn">Archived</Badge>}
          {v.is_public ? <Badge tone="green">On website</Badge> : <Badge>Staff only</Badge>}
          {v.relabel_needed && <Badge tone="warn">Replace shelf labels</Badge>}
        </div>
      </div>
      <form action={action} className="flex flex-col gap-4">
        <VariantFields v={v} showAlias={false} idPrefix={`v${v.id}-`} />
        <Result state={state} />
        {state?.ok && (state.data as { priceChanged?: boolean })?.priceChanged && (
          <Alert tone="warn">Price changed — the shelf labels for this size are flagged for replacement. <Link className="font-semibold underline" href={`/admin/labels?variant=${v.id}`}>Print replacement labels</Link></Alert>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" busy={pending}>Save size</Button>
          <Link className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-forest hover:bg-leaf" href={`/admin/labels?variant=${v.id}`}>Print labels</Link>
          <Link className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-forest hover:bg-leaf" href={`/admin/stock/${v.id}`}>Stock history</Link>
          <Button type="button" variant={v.archived ? "secondary" : "ghost"} className={v.archived ? "" : "text-danger"} busy={archPending} onClick={() => {
            if (!v.archived && !confirm(`Archive ${v.size_label}? Its barcode stops scanning and is never reused. History is kept.`)) return;
            start(async () => setArchMsg(await setVariantArchivedAction(v.id, !v.archived)));
          }}>{v.archived ? "Restore size" : "Archive size"}</Button>
        </div>
        {archMsg && <Result state={archMsg} />}
      </form>
      <div className="mt-5 border-t border-line pt-4">
        <h4 className="text-sm font-semibold">Supplier barcodes</h4>
        {v.aliases.length === 0 ? <p className="mt-1 text-sm text-muted">None. Only the internal label barcode scans.</p> : (
          <ul className="mt-2 flex flex-wrap gap-2">
            {v.aliases.map((a) => (
              <li key={a.code} className="flex items-center gap-1 rounded-lg border border-line px-2 py-1 font-mono text-sm">
                {a.code} {a.retired ? <Badge>Retired</Badge> : (
                  <button type="button" className="min-h-9 rounded px-2 text-xs text-danger underline" onClick={async () => { if (confirm(`Stop ${a.code} from scanning? It can never be reused.`)) await retireAliasAction(a.code); }}>Retire</button>
                )}
              </li>
            ))}
          </ul>
        )}
        <form action={aliasAction} className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
          <Field label="Add supplier barcode" htmlFor={`alias-${v.id}`} className="flex-1">
            <input id={`alias-${v.id}`} name="code" required maxLength={48} className={cx(inputClass, "font-mono")} autoComplete="off" placeholder="Scan the supplier's barcode" />
          </Field>
          <Button type="submit" variant="secondary" busy={aliasPending}>Add</Button>
        </form>
        <div className="mt-2"><Result state={aliasState} /></div>
      </div>
    </Card>
  );
}

export function AddVariantForm({ productId }: { productId: number }) {
  const [state, action, pending] = useActionState(createVariantAction.bind(null, productId), null);
  return (
    <form action={action} className="flex flex-col gap-4" key={state?.ok ? String(Date.now()) : "form"}>
      <VariantFields idPrefix="new-" />
      <Result state={state} />
      <div><Button type="submit" busy={pending}>Add size</Button></div>
    </form>
  );
}
