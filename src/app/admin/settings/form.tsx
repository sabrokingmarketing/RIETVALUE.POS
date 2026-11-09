"use client";
import { useActionState, useState } from "react";
import type { Settings } from "@/server/settings";
import { Alert, Button, Card, Field, cx, inputClass } from "@/components/ui";
import { updateSettingsAction } from "../actions";

export function SettingsForm({ s }: { s: Settings }) {
  const [state, action, pending] = useActionState(updateSettingsAction, null);
  const [vat, setVat] = useState(s.vat_registered);
  const t = (name: string, label: string, value: string, opts: { hint?: string; rows?: number; type?: string; full?: boolean } = {}) => (
    <Field label={label} htmlFor={name} hint={opts.hint} className={opts.full ? "sm:col-span-2" : ""}>
      {opts.rows ? <textarea id={name} name={name} rows={opts.rows} defaultValue={value} className={cx(inputClass, "py-2")} />
        : <input id={name} name={name} type={opts.type ?? "text"} defaultValue={value} className={inputClass} />}
    </Field>
  );
  return (
    <form action={action} className="flex flex-col gap-6">
      <Card className="grid gap-4 p-5 sm:grid-cols-2">
        <h2 className="font-semibold sm:col-span-2">Business</h2>
        {t("businessName", "Trading name", s.business_name)}
        {t("legalName", "Registered name (optional)", s.legal_name)}
        {t("registrationNo", "Company registration no. (optional)", s.registration_no)}
        {t("tagline", "Website tagline", s.tagline)}
        {t("addressLines", "Street address", s.address_lines, { rows: 3 })}
        {t("openingHours", "Opening hours (one line each)", s.opening_hours, { rows: 3 })}
        {t("phone", "Phone", s.phone, { type: "tel" })}
        {t("whatsappNumber", "WhatsApp number", s.whatsapp_number, { hint: "International format, e.g. 27 82 123 4567", type: "tel" })}
        {t("email", "E-mail", s.email, { type: "email" })}
        {t("mapUrl", "Map link (Google Maps share link)", s.map_url, { type: "url", hint: "Starts with https://" })}
        {t("directions", "Directions", s.directions, { rows: 3, full: true })}
        {t("aboutText", "About us (website)", s.about_text, { rows: 6, full: true })}
        {t("receiptFooter", "Receipt footer", s.receipt_footer, { rows: 2, full: true, hint: "e.g. your returns policy" })}
      </Card>
      <Card className="grid gap-4 p-5 sm:grid-cols-2">
        <h2 className="font-semibold sm:col-span-2">VAT</h2>
        <label className="flex min-h-11 items-center gap-3 text-sm sm:col-span-2">
          <input type="checkbox" name="vatRegistered" checked={vat} onChange={(e) => setVat(e.target.checked)} className="size-5 accent-forest" />
          The business is registered for VAT with SARS (receipts become tax invoices showing VAT included)
        </label>
        {vat && <>
          {t("vatNumber", "VAT number", s.vat_number, { hint: "10 digits starting with 4" })}
          {t("vatRatePercent", "VAT rate (%)", String(s.vat_rate_bp / 100), { type: "number", hint: "South Africa: 15%" })}
        </>}
        {!vat && <><input type="hidden" name="vatNumber" value={s.vat_number} /><input type="hidden" name="vatRatePercent" value={String(s.vat_rate_bp / 100)} /></>}
        <p className="text-sm text-muted sm:col-span-2">Prices are entered including VAT. Each sale stores the VAT rate it used, so changing this later never alters past receipts or return amounts. Confirm your VAT treatment with your accountant before launch.</p>
      </Card>
      {state && (state.ok ? <Alert tone="success">{state.message}</Alert> : <Alert tone="error">{state.error}</Alert>)}
      <div><Button type="submit" size="lg" busy={pending}>Save settings</Button></div>
    </form>
  );
}
