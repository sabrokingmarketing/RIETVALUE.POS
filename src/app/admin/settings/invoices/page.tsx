import type { Metadata } from "next";
import { pageActor } from "@/server/session";
import { getSettings } from "@/server/settings";
import { mailConfigured } from "@/server/mail";
import { currentLogo } from "@/server/logo";
import { PageHeader } from "@/components/ui";
import { SectionTabs } from "@/components/section-tabs";
import { InvoiceSettingsForm } from "./form";

export const metadata: Metadata = { title: "Invoice settings" };

export default async function InvoiceSettingsPage() {
  await pageActor(["owner"], "/admin/settings/invoices");
  const s = await getSettings();
  return (
    <div className="mx-auto max-w-4xl">
      <SectionTabs set="settings" active="/admin/settings/invoices" />
      <PageHeader title="Invoices & logo" description="Your logo, bank details and payment terms for every invoice — from the till or made by hand." />
      <InvoiceSettingsForm s={{ logoFile: s.logo_file, logoUrl: (await currentLogo(s.logo_file))?.url ?? null, paymentInfo: s.invoice_payment_info, termsDays: s.invoice_terms_days, thanks: s.invoice_thanks, businessName: s.business_name, email: s.email }}
        mail={{ configured: mailConfigured(), from: process.env.MAIL_FROM ?? "" }} />
    </div>
  );
}
