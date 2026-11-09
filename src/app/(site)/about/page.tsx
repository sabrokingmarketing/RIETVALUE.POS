import type { Metadata } from "next";
import { getPublicSettings } from "@/server/settings";

export const metadata: Metadata = { title: "About" };

export default async function About() {
  const s = await getPublicSettings();
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <h1 className="text-4xl font-semibold">About {s.business_name}</h1>
      <div className="mt-6 space-y-4 text-lg leading-relaxed">
        {(s.about_text || "We are an independent plant nursery.").split(/\n{2,}/).map((para, i) => <p key={i} className="whitespace-pre-line">{para}</p>)}
      </div>
    </div>
  );
}
