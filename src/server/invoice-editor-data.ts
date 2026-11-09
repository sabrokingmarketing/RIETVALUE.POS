import "server-only";
import { getSettings } from "./settings";
import { todayBusinessDate } from "@/lib/dates";
import { addDays } from "@/lib/invoice-format";
import type { DocBusiness } from "@/components/invoice/invoice-document";

/** Business details and defaults the invoice editor needs. */
export async function editorContext() {
  const s = await getSettings();
  const today = todayBusinessDate();
  const business: DocBusiness = {
    business_name: s.business_name, legal_name: s.legal_name, registration_no: s.registration_no, vat_number: s.vat_registered ? s.vat_number : "",
    address_lines: s.address_lines, phone: s.phone, email: s.email, vat_rate_bp: s.vat_registered ? s.vat_rate_bp : 0, thanks: s.invoice_thanks,
  };
  return {
    business, today, vatRegistered: s.vat_registered, vatRateBp: s.vat_rate_bp, termsDays: s.invoice_terms_days, logoFile: s.logo_file,
    paymentInfo: s.invoice_payment_info, defaultDue: s.invoice_terms_days ? addDays(today, s.invoice_terms_days) : "",
  };
}
