import Link from "next/link";
import { Clock, MapPin } from "lucide-react";
import { getPublicSettings } from "@/server/settings";
import { publicCatalogue } from "@/server/public";
import { PlantCard } from "@/components/site/plant-card";
import { photoUrl } from "@/lib/photo";
import { ButtonLink } from "@/components/ui";

export default async function Home() {
  const [s, plants] = await Promise.all([getPublicSettings(), publicCatalogue()]);
  const available = plants.filter((p) => p.variants.some((v) => v.availability !== "sold_out"));
  const hero = available.find((p) => p.photo_path) ?? plants.find((p) => p.photo_path);
  const featured = available.slice(0, 6);
  return (
    <>
      <section className="relative overflow-hidden bg-leaf">
        <div className="mx-auto grid max-w-7xl items-center gap-8 px-4 py-12 sm:px-6 md:grid-cols-2 md:py-20">
          <div>
            <h1 className="text-4xl font-semibold leading-tight text-ink sm:text-5xl">{s.tagline || `Plants from ${s.business_name}`}</h1>
            <p className="mt-4 max-w-lg text-lg text-muted">Browse what is on our tables today, then come and choose your plants in person. Prices include VAT.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href="/plants" size="lg">Browse plants</ButtonLink>
              <ButtonLink href="/visit" size="lg" variant="secondary">Visit us</ButtonLink>
            </div>
          </div>
          {hero && photoUrl(hero.photo_path) && (
            <figure>
              <img src={photoUrl(hero.photo_path)!} alt={hero.photo_is_fixture ? `Placeholder illustration of ${hero.common_name}` : hero.common_name} className="aspect-[5/4] w-full rounded-3xl object-cover shadow-sm" />
              <figcaption className="mt-2 text-sm text-muted">{hero.common_name}{hero.photo_is_fixture ? " — placeholder illustration" : ""}</figcaption>
            </figure>
          )}
        </div>
      </section>
      <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
        <div className="mb-6 flex items-end justify-between gap-4">
          <h2 className="text-2xl font-semibold sm:text-3xl">In the nursery now</h2>
          <Link href="/plants" className="inline-flex min-h-11 items-center font-semibold text-forest underline">See all plants</Link>
        </div>
        {featured.length === 0 ? <p className="text-muted">Our online list is being updated. Visit or WhatsApp us to ask what is available.</p> : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">{featured.map((p) => <PlantCard key={p.product_id} p={p} />)}</div>
        )}
      </section>
      <section className="mx-auto grid max-w-7xl gap-6 px-4 sm:px-6 md:grid-cols-2">
        <div className="rounded-2xl bg-mist p-6">
          <h2 className="flex items-center gap-2 text-xl font-semibold"><Clock className="size-5 text-forest" aria-hidden /> Opening hours</h2>
          <p className="mt-3 whitespace-pre-line">{s.opening_hours || "Contact us for opening hours."}</p>
        </div>
        <div className="rounded-2xl bg-mist p-6">
          <h2 className="flex items-center gap-2 text-xl font-semibold"><MapPin className="size-5 text-forest" aria-hidden /> Find us</h2>
          <p className="mt-3 whitespace-pre-line">{s.address_lines}</p>
          <Link href="/visit" className="mt-3 inline-flex min-h-11 items-center font-semibold text-forest underline">Directions and contact</Link>
        </div>
      </section>
    </>
  );
}
