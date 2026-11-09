import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { availabilityText, publicPlant } from "@/server/public";
import { getPublicSettings } from "@/server/settings";
import { photoUrl } from "@/lib/photo";
import { formatRand } from "@/lib/money";
import { Badge } from "@/components/ui";
import { WhatsAppButton } from "@/components/site/whatsapp";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const p = await publicPlant((await params).slug);
  return { title: p ? p.common_name : "Plant not found", description: p?.description.slice(0, 160) };
}

export default async function PlantPage({ params }: { params: Promise<{ slug: string }> }) {
  const [p, s] = await Promise.all([publicPlant((await params).slug), getPublicSettings()]);
  if (!p) notFound();
  const img = photoUrl(p.photo_path);
  const first = p.variants.find((v) => v.availability !== "sold_out") ?? p.variants[0];
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <Link href="/plants" className="inline-flex min-h-11 items-center text-forest underline">← All plants</Link>
      <div className="mt-4 grid gap-10 lg:grid-cols-[1.2fr_1fr]">
        <figure>
          {img ? <img src={img} alt={p.photo_is_fixture ? `Placeholder illustration of ${p.common_name}` : p.common_name} className="aspect-[5/4] w-full rounded-3xl bg-leaf object-cover" />
            : <div className="aspect-[5/4] w-full rounded-3xl bg-leaf" />}
          {p.photo_is_fixture && <figcaption className="mt-2 text-sm text-muted">Placeholder illustration — the nursery will add a real photo.</figcaption>}
        </figure>
        <div>
          <p className="text-sm font-medium uppercase tracking-wide text-forest">{p.category_name}</p>
          <h1 className="mt-1 text-4xl font-semibold">{p.common_name}</h1>
          {p.botanical_name && <p className="mt-1 text-lg italic text-muted">{p.botanical_name}</p>}
          {p.description && <p className="mt-5 text-lg leading-relaxed">{p.description}</p>}
          <h2 className="mt-8 text-lg font-semibold">Sizes and prices</h2>
          <ul className="mt-3 divide-y divide-line rounded-2xl border border-line">
            {p.variants.map((v) => (
              <li key={v.variant_id} className="flex items-center justify-between gap-4 px-4 py-3">
                <span className="font-medium">{v.size_label}</span>
                <span className="flex items-center gap-3">
                  <Badge tone={v.availability === "in_stock" ? "green" : v.availability === "limited" ? "warn" : "neutral"}>{availabilityText(v.availability)}</Badge>
                  <span className="tabular text-lg font-semibold">{formatRand(v.price_cents)}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-6 flex flex-wrap gap-3">
            <WhatsAppButton size="lg" number={s.whatsapp_number} fixture={s.is_fixture}
              text={`Hi ${s.business_name}! Is the ${p.common_name} (${first.size_label}, ${formatRand(first.price_cents)}) available? I saw it on your website.`}
              label="Ask about this plant" />
            <Link href="/visit" className="inline-flex min-h-14 items-center rounded-lg border border-line px-6 text-lg font-semibold hover:bg-leaf">Visit us</Link>
          </div>
          {s.is_fixture && <p className="mt-2 text-xs text-muted">WhatsApp number is a development placeholder.</p>}
          {p.care_notes && (<><h2 className="mt-8 text-lg font-semibold">Care</h2><p className="mt-2 leading-relaxed">{p.care_notes}</p></>)}
          <p className="mt-8 text-sm text-muted">We sell in the nursery only — no online orders or delivery. Prices include VAT and may change.</p>
        </div>
      </div>
    </div>
  );
}
