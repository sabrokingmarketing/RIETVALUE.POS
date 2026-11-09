"use client";
import { useState } from "react";
import { Download } from "lucide-react";
import { buttonClass, inputClass } from "@/components/ui";

/** Builds a filtered export link. The server decides which columns the signed-in role may export. */
export function ExportPanel({ categories, isOwner }: { categories: { slug: string; name: string }[]; isOwner: boolean }) {
  const [q, setQ] = useState(""); const [category, setCategory] = useState(""); const [status, setStatus] = useState("active"); const [low, setLow] = useState(false);
  const href = (format: string) => `/api/export?${new URLSearchParams({ format, ...(q ? { q } : {}), ...(category ? { category } : {}), status, ...(low ? { low: "1" } : {}) })}`;
  return (
    <section className="card flex flex-col gap-4 p-5" aria-labelledby="export-h">
      <div>
        <h2 id="export-h" className="font-semibold">Export products</h2>
        <p className="mt-1 text-sm text-muted">
          {isOwner ? "Every size with its SKU, barcodes, price, stock and status — in the same format as the import template, so you can edit it and import it back."
            : "A price list: name, category, size, SKU, barcode, price and stock."}
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-1"><label htmlFor="ex-q" className="text-sm font-medium">Name or SKU contains</label><input id="ex-q" className={inputClass} value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="flex flex-col gap-1"><label htmlFor="ex-cat" className="text-sm font-medium">Category</label>
          <select id="ex-cat" className={inputClass} value={category} onChange={(e) => setCategory(e.target.value)}><option value="">All categories</option>{categories.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}</select></div>
        <div className="flex flex-col gap-1"><label htmlFor="ex-status" className="text-sm font-medium">Status</label>
          <select id="ex-status" className={inputClass} value={status} onChange={(e) => setStatus(e.target.value)}><option value="active">Active</option><option value="archived">Archived</option><option value="all">All</option></select></div>
        <label className="flex min-h-11 items-center gap-3 self-end text-sm"><input type="checkbox" checked={low} onChange={(e) => setLow(e.target.checked)} className="size-5 accent-deep" /> Low stock only</label>
      </div>
      <div className="flex flex-wrap gap-2">
        <a className={buttonClass("primary")} href={href("xlsx")} data-testid="export-xlsx"><Download className="size-4" aria-hidden /> Export Excel (.xlsx)</a>
        <a className={buttonClass("secondary")} href={href("csv")} data-testid="export-csv"><Download className="size-4" aria-hidden /> Export CSV</a>
      </div>
      <p className="text-xs text-muted">Barcodes are saved as text so leading zeros are kept. CSV cells that start with = + - or @ get a leading apostrophe so spreadsheets never run them as formulas; the import removes it again.</p>
    </section>
  );
}
