import Link from "next/link";
import type { PublicPlant } from "@/server/public";
import { photoUrl } from "@/lib/photo";
import { formatRand } from "@/lib/money";

export function PlantCard({ p }: { p: PublicPlant }) {
  const from = Math.min(...p.variants.map((v) => v.price_cents));
  const anyAvailable = p.variants.some((v) => v.availability !== "sold_out");
  const img = photoUrl(p.photo_path);
  return (
    <Link href={`/plants/${p.slug}`} className="group flex flex-col overflow-hidden rounded-2xl bg-surface ring-1 ring-line transition hover:ring-forest">
      <div className="relative aspect-[5/4] overflow-hidden bg-leaf">
        {img ? <img src={img} alt={p.photo_is_fixture ? `Placeholder illustration of ${p.common_name}` : p.common_name} loading="lazy" className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]" /> : null}
        {!anyAvailable && <span className="absolute left-3 top-3 rounded-full bg-surface px-3 py-1 text-xs font-semibold">Sold out</span>}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-4">
        <h3 className="text-lg font-semibold leading-snug">{p.common_name}</h3>
        {p.botanical_name && <p className="text-sm italic text-muted">{p.botanical_name}</p>}
        <p className="mt-auto pt-2 text-sm"><span className="text-muted">{p.variants.length > 1 ? "From " : ""}</span><span className="tabular font-semibold">{formatRand(from)}</span>
          <span className="text-muted"> · {p.variants.map((v) => v.size_label).join(", ")}</span></p>
      </div>
    </Link>
  );
}
