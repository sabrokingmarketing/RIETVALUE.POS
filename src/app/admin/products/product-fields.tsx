import type { Category } from "@/server/catalog";
import { Field, inputClass, cx } from "@/components/ui";

export function ProductFields({ categories, p }: { categories: Category[]; p?: { common_name: string; botanical_name: string; category_id: number; description: string; care_notes: string } }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Common name" htmlFor="commonName" hint="As customers know it, e.g. Lavender. Printed on labels.">
        <input id="commonName" name="commonName" required maxLength={80} defaultValue={p?.common_name} className={inputClass} />
      </Field>
      <Field label="Botanical name (optional)" htmlFor="botanicalName">
        <input id="botanicalName" name="botanicalName" maxLength={120} defaultValue={p?.botanical_name} className={cx(inputClass, "italic")} />
      </Field>
      <Field label="Category" htmlFor="categoryId">
        <select id="categoryId" name="categoryId" required defaultValue={p?.category_id ?? ""} className={inputClass}>
          <option value="" disabled>Choose…</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>
      <Field label="Photo (optional)" htmlFor="photo" hint="JPEG, PNG or WebP up to 5 MB. Shown on the website.">
        <input id="photo" name="photo" type="file" accept="image/jpeg,image/png,image/webp" className="min-h-11 text-sm file:mr-3 file:min-h-11 file:rounded-lg file:border file:border-line file:bg-mist file:px-3 file:font-medium" />
      </Field>
      <Field label="Description for the website" htmlFor="description" className="sm:col-span-2">
        <textarea id="description" name="description" rows={3} maxLength={2000} defaultValue={p?.description} className={cx(inputClass, "py-2")} />
      </Field>
      <Field label="Care notes" htmlFor="careNotes" className="sm:col-span-2">
        <textarea id="careNotes" name="careNotes" rows={2} maxLength={2000} defaultValue={p?.care_notes} className={cx(inputClass, "py-2")} />
      </Field>
    </div>
  );
}

export function VariantFields({ v, showAlias = true, idPrefix = "" }: { v?: { size_label: string; sku: string; price_cents: number; low_stock_threshold: number; is_public: boolean }; showAlias?: boolean; idPrefix?: string }) {
  const id = (s: string) => `${idPrefix}${s}`;
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Field label="Pot or pack size" htmlFor={id("sizeLabel")} hint="e.g. 15 cm pot, 4 L bag, 6-pack">
        <input id={id("sizeLabel")} name="sizeLabel" required maxLength={40} defaultValue={v?.size_label} className={inputClass} />
      </Field>
      <Field label="Selling price (R, incl. VAT)" htmlFor={id("price")}>
        <input id={id("price")} name="price" required inputMode="decimal" defaultValue={v ? (v.price_cents / 100).toFixed(2) : ""} placeholder="89.90" className={cx(inputClass, "tabular")} />
      </Field>
      <Field label="SKU" htmlFor={id("sku")} hint={v ? "Letters, numbers and dashes." : "Leave blank to create one automatically."}>
        <input id={id("sku")} name="sku" maxLength={32} required={!!v} defaultValue={v?.sku} className={cx(inputClass, "font-mono uppercase")} />
      </Field>
      <Field label="Low-stock warning at" htmlFor={id("lowStockThreshold")}>
        <input id={id("lowStockThreshold")} name="lowStockThreshold" type="number" min={0} max={10000} defaultValue={v?.low_stock_threshold ?? 3} className={inputClass} />
      </Field>
      {showAlias && (
        <Field label="Supplier barcode (optional)" htmlFor={id("aliasBarcode")} hint="Scan an existing supplier code so it also rings up. Leading zeros are kept.">
          <input id={id("aliasBarcode")} name="aliasBarcode" maxLength={48} className={cx(inputClass, "font-mono")} autoComplete="off" />
        </Field>
      )}
      <label className="flex min-h-11 items-center gap-3 self-end text-sm font-medium">
        <input type="checkbox" name="isPublic" defaultChecked={v?.is_public ?? true} className="size-5 accent-forest" /> Show on the website
      </label>
    </div>
  );
}
