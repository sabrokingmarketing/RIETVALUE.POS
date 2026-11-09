import type { Metadata } from "next";
import { Clock, Mail, MapPin, Phone } from "lucide-react";
import { getPublicSettings } from "@/server/settings";
import { WhatsAppButton } from "@/components/site/whatsapp";
import { buttonClass } from "@/components/ui";

export const metadata: Metadata = { title: "Visit & contact" };

export default async function Visit() {
  const s = await getPublicSettings();
  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
      <h1 className="text-4xl font-semibold">Visit &amp; contact</h1>
      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <section className="rounded-2xl bg-mist p-6">
          <h2 className="flex items-center gap-2 text-xl font-semibold"><MapPin className="size-5 text-forest" aria-hidden /> Address</h2>
          <p className="mt-3 whitespace-pre-line text-lg">{s.address_lines || "Address coming soon."}</p>
          {s.map_url && <a href={s.map_url} target="_blank" rel="noopener noreferrer" className={buttonClass("secondary", "md", "mt-4")}>Open in maps</a>}
          {s.directions && <><h3 className="mt-6 font-semibold">Directions</h3><p className="mt-1 whitespace-pre-line">{s.directions}</p></>}
        </section>
        <section className="rounded-2xl bg-mist p-6">
          <h2 className="flex items-center gap-2 text-xl font-semibold"><Clock className="size-5 text-forest" aria-hidden /> Opening hours</h2>
          <p className="mt-3 whitespace-pre-line text-lg">{s.opening_hours || "Contact us for opening hours."}</p>
        </section>
        <section className="rounded-2xl bg-mist p-6 md:col-span-2">
          <h2 className="text-xl font-semibold">Talk to us</h2>
          <div className="mt-4 flex flex-wrap gap-3">
            <WhatsAppButton size="lg" number={s.whatsapp_number} text={`Hi ${s.business_name}, I have a question.`} label="WhatsApp" fixture={s.is_fixture} />
            {s.phone && <a href={`tel:${s.phone.replace(/\s/g, "")}`} className={buttonClass("secondary", "lg")}><Phone className="size-5" aria-hidden /> {s.phone}</a>}
            {s.email && <a href={`mailto:${s.email}`} className={buttonClass("secondary", "lg")}><Mail className="size-5" aria-hidden /> {s.email}</a>}
          </div>
          {s.is_fixture && <p className="mt-3 text-sm text-warn">These contact details are development placeholders, not a real business.</p>}
        </section>
      </div>
    </div>
  );
}
