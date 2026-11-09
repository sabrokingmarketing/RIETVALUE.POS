import "server-only";
import { z } from "zod";
import { boolish } from "@/lib/zod-helpers";
import { q, q1, type Db } from "./db";
import { AppError } from "./errors";
import { assertRole, type Actor } from "./session-types";
import { audit } from "./audit";

export type Settings = {
  business_name: string; legal_name: string; registration_no: string; vat_registered: boolean; vat_number: string;
  vat_rate_bp: number; address_lines: string; phone: string; whatsapp_number: string; email: string;
  opening_hours: string; map_url: string; directions: string; tagline: string; about_text: string;
  receipt_footer: string; is_fixture: boolean;
};

export async function getSettings(db?: Db): Promise<Settings> {
  const s = await q1<Settings>(
    `SELECT business_name, legal_name, registration_no, vat_registered, vat_number, vat_rate_bp, address_lines, phone,
            whatsapp_number, email, opening_hours, map_url, directions, tagline, about_text, receipt_footer, is_fixture
     FROM settings WHERE id = 1`, [], db);
  return s!;
}

/** Public subset — never includes registration/VAT internals beyond what a receipt shows. */
export type PublicSettings = Pick<Settings,
  "business_name" | "address_lines" | "phone" | "whatsapp_number" | "email" | "opening_hours" | "map_url" | "directions" | "tagline" | "about_text" | "is_fixture">;

export async function getPublicSettings(): Promise<PublicSettings> {
  const s = await getSettings();
  return {
    business_name: s.business_name, address_lines: s.address_lines, phone: s.phone, whatsapp_number: s.whatsapp_number,
    email: s.email, opening_hours: s.opening_hours, map_url: s.map_url, directions: s.directions, tagline: s.tagline,
    about_text: s.about_text, is_fixture: s.is_fixture,
  };
}

const t = (max: number) => z.string().trim().max(max).default("");
export const settingsInput = z.object({
  businessName: z.string().trim().min(1, "Enter the trading name").max(80),
  legalName: t(120),
  registrationNo: t(40),
  vatRegistered: boolish().default(false),
  vatNumber: t(20),
  vatRatePercent: z.coerce.number().min(0).max(100).default(15),
  addressLines: t(400),
  phone: t(30),
  whatsappNumber: z.string().trim().transform((s) => s.replace(/[^\d]/g, "")).pipe(z.string().max(15, "WhatsApp number is too long")).default(""),
  email: z.union([z.literal(""), z.string().trim().email("Enter a valid e-mail address")]).default(""),
  openingHours: t(600),
  mapUrl: z.union([z.literal(""), z.string().trim().url("Map link must be a full https:// address").refine((u) => u.startsWith("https://"), "Map link must start with https://")]).default(""),
  directions: t(1000),
  tagline: t(140),
  aboutText: t(4000),
  receiptFooter: t(300),
}).superRefine((v, ctx) => {
  if (v.vatRegistered && !/^4\d{9}$/.test(v.vatNumber)) {
    ctx.addIssue({ code: "custom", path: ["vatNumber"], message: "A South African VAT number has 10 digits and starts with 4" });
  }
});

export async function updateSettings(actor: Actor, input: z.input<typeof settingsInput>) {
  assertRole(actor, ["owner"]);
  const r = settingsInput.safeParse(input);
  if (!r.success) throw new AppError("VALIDATION", r.error.issues[0].message);
  const v = r.data;
  await q(
    `UPDATE settings SET business_name=$1, legal_name=$2, registration_no=$3, vat_registered=$4, vat_number=$5, vat_rate_bp=$6,
       address_lines=$7, phone=$8, whatsapp_number=$9, email=$10, opening_hours=$11, map_url=$12, directions=$13, tagline=$14,
       about_text=$15, receipt_footer=$16, is_fixture=false, updated_at=now(), updated_by=$17 WHERE id=1`,
    [v.businessName, v.legalName, v.registrationNo, v.vatRegistered, v.vatNumber, Math.round(v.vatRatePercent * 100),
      v.addressLines, v.phone, v.whatsappNumber, v.email, v.openingHours, v.mapUrl, v.directions, v.tagline, v.aboutText,
      v.receiptFooter, actor.id],
  );
  await audit(undefined, actor, "settings.update", "settings", 1, v);
}
