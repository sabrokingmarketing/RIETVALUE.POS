"use client";
import { Flower, Flower2, House, LayoutGrid, Leaf, Shovel, Sprout, TreeDeciduous, type LucideIcon } from "lucide-react";
import { cx } from "@/components/ui";
import type { PosCategory } from "@/lib/till-types";

/** A recognisable icon per kind of category (falls back to a leaf). */
export function categoryIcon(name: string): LucideIcon {
  const n = name.toLowerCase();
  if (/herb|lavender|veg|edible/.test(n)) return Sprout;
  if (/succulent|aloe|cact|vygie/.test(n)) return Leaf;
  if (/rose|flower|annual|perennial|bulb/.test(n)) return Flower2;
  if (/indigenous|fynbos|protea|native/.test(n)) return Flower;
  if (/indoor|house|office/.test(n)) return House;
  if (/tree|shrub|hedge/.test(n)) return TreeDeciduous;
  if (/pot|planter|container/.test(n)) return CupIcon;
  if (/suppl|soil|compost|tool|fertili|garden/.test(n)) return Shovel;
  return Leaf;
}

/** Simple plant-pot outline in the same stroke style as the Lucide icons. */
const CupIcon = ((props: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M4 6h16v3H4z" /><path d="M5.5 9h13l-1.6 10.2a1 1 0 0 1-1 .8H8.1a1 1 0 0 1-1-.8z" />
  </svg>
)) as unknown as LucideIcon;

/**
 * Category tiles: a wrapping grid on wide screens, a snap-scrolling row (no scrollbar)
 * on phones. The selected tile is deep green with a bright-green icon (8.7:1 white text).
 */
export function CategoryPicker({ categories, value, onChange }: { categories: PosCategory[]; value: string | null; onChange: (slug: string | null) => void }) {
  const total = categories.reduce((a, c) => a + c.count, 0);
  const items = [{ slug: null as string | null, name: "All products", count: total, Icon: LayoutGrid }, ...categories.map((c) => ({ ...c, Icon: categoryIcon(c.name) }))];
  const current = items.find((c) => c.slug === value);
  return (
    <section aria-labelledby="cat-h" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="cat-h" className="text-lg font-semibold">Categories</h2>
        {value && (
          <button type="button" onClick={() => onChange(null)} className="inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold text-deep hover:bg-soft">
            Showing {current?.name} · Show all
          </button>
        )}
      </div>
      <div role="group" aria-label="Filter products by category"
        className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:grid sm:snap-none sm:grid-cols-[repeat(auto-fill,minmax(136px,1fr))] sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden">
        {items.map(({ slug, name, count, Icon }) => {
          const on = value === slug;
          return (
            <button key={slug ?? "all"} type="button" aria-pressed={on} onClick={() => onChange(slug)}
              className={cx(
                "group relative flex w-32 shrink-0 snap-start flex-col items-start gap-3 rounded-2xl border p-3 text-left transition-all sm:w-auto",
                "focus-visible:outline-3 focus-visible:outline-offset-2",
                on ? "border-deep bg-deep text-white shadow-[0_6px_20px_rgb(54_83_20/0.25)]"
                   : "border-line bg-surface text-ink shadow-[var(--shadow-card)] hover:-translate-y-0.5 hover:border-deep/30 hover:shadow-[0_6px_20px_rgb(23_33_27/0.08)]",
              )}>
              <span className={cx("inline-flex size-11 items-center justify-center rounded-xl transition-colors",
                on ? "bg-primary text-ink" : "bg-soft text-deep group-hover:bg-soft-strong")} aria-hidden>
                <Icon className="size-5" />
              </span>
              <span className="flex w-full flex-col">
                <span className="line-clamp-2 text-sm font-semibold leading-snug">{name}</span>
                <span className={cx("tabular text-xs", on ? "text-white/80" : "text-muted")}>{count} item{count === 1 ? "" : "s"}</span>
              </span>
              {on && <span className="absolute right-3 top-3 size-2.5 rounded-full bg-primary" aria-hidden />}
            </button>
          );
        })}
      </div>
    </section>
  );
}
