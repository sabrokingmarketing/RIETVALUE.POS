import type { Metadata } from "next";
import { pageActor } from "@/server/session";
import { currentTill } from "@/server/till";
import { TillScreen } from "@/components/till/till-screen";

export const metadata: Metadata = { title: "Till" };

export default async function TillPage() {
  const actor = await pageActor(["owner", "cashier"], "/till");
  const till = await currentTill();
  return <TillScreen tillOpen={!!till} staffName={actor.name} />;
}
