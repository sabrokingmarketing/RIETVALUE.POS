"use client";
import { useActionState, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ImageUp, Mail, MailWarning, RotateCcw } from "lucide-react";
import { Alert, Button, Card, cx, inputClass } from "@/components/ui";
import { LogoMark } from "@/components/invoice/logo-mark";
import { clearLogoAction, invoiceSettingsAction, uploadLogoAction } from "@/app/admin/invoices/actions";

type S = { logoFile: string; logoUrl: string | null; paymentInfo: string; termsDays: number; thanks: string; businessName: string; email: string };

export function InvoiceSettingsForm({ s, mail }: { s: S; mail: { configured: boolean; from: string } }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(invoiceSettingsAction, null);
  const [logoState, logoAction, logoPending] = useActionState(uploadLogoAction, null);
  const [clearing, startClear] = useTransition();
  const [drag, setDrag] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [terms, setTerms] = useState(String(s.termsDays));

  const choose = (f: File | undefined) => {
    if (!f || !fileRef.current) return;
    const dt = new DataTransfer(); dt.items.add(f); fileRef.current.files = dt.files;
    setPreview(URL.createObjectURL(f));
    formRef.current?.requestSubmit();
  };

  return (
    <div className="flex flex-col gap-6">
      <Card className="p-5 sm:p-6">
        <h2 className="font-semibold">Logo</h2>
        <p className="text-sm text-muted">Your logo exactly as uploaded — shown at the top of every invoice PDF and invoice e-mail. Use the original PNG or JPG file (up to 2 MB).</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-[180px_1fr] sm:items-center">
          <div className="flex aspect-square items-center justify-center rounded-3xl bg-mist p-4 ring-1 ring-line">
            {preview ? <img src={preview} alt="New logo" className="size-full object-contain" /> : (s.logoUrl ? <LogoMark src={s.logoUrl} className="size-full" alt={`${s.businessName} logo`} /> : <span className="px-3 text-center text-sm text-muted">No logo yet</span>)}
          </div>
          <form ref={formRef} action={(f) => { logoAction(f); setTimeout(() => router.refresh(), 300); }}>
            <label onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); choose(e.dataTransfer.files?.[0]); }}
              className={cx("flex min-h-36 cursor-pointer flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed p-5 text-center transition", drag ? "border-deep bg-soft" : "border-field/50 hover:border-deep/50 hover:bg-soft/50")}>
              <span className="inline-flex size-11 items-center justify-center rounded-2xl bg-soft text-deep"><ImageUp className="size-5" aria-hidden /></span>
              <span className="font-semibold">{logoPending ? "Uploading…" : "Drop your logo here, or click to choose"}</span>
              <span className="text-xs text-muted">PNG or JPG · up to 2 MB</span>
              <input ref={fileRef} type="file" name="logo" accept="image/png,image/jpeg" className="sr-only" onChange={(e) => choose(e.target.files?.[0])} data-testid="logo-input" />
            </label>
          </form>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {s.logoFile ? <Button variant="ghost" onClick={() => startClear(async () => { await clearLogoAction(); setPreview(null); router.refresh(); })} busy={clearing}><RotateCcw className="size-4" aria-hidden /> Remove uploaded logo</Button>
            : <p className="text-sm text-muted">Upload your Rietvallei logo file here. Until then, invoices show the business name in text.</p>}
          {logoState && (logoState.ok ? <span className="inline-flex items-center gap-1.5 text-sm font-medium text-deep"><CheckCircle2 className="size-4" aria-hidden /> {logoState.message}</span> : <Alert tone="error">{logoState.error}</Alert>)}
        </div>
      </Card>

      <form action={action} className="flex flex-col gap-6">
        <Card className="grid gap-4 p-5 sm:grid-cols-2 sm:p-6">
          <h2 className="font-semibold sm:col-span-2">Payment details and terms</h2>
          <div className="flex flex-col gap-1 sm:row-span-2">
            <label htmlFor="paymentInfo" className="text-sm font-medium">How customers pay you</label>
            <textarea id="paymentInfo" name="paymentInfo" rows={5} defaultValue={s.paymentInfo} maxLength={600} className={cx(inputClass, "py-2")}
              placeholder={"Bank: FNB\nAccount name: Rietvallei Nursery\nAccount no: 62xxxxxxxxx · Branch: 250655\nReference: your invoice number"} />
            <p className="text-xs text-muted">Pre-filled on every new invoice. You can change it per invoice.</p>
          </div>
          <fieldset className="flex flex-col gap-1">
            <legend className="text-sm font-medium">Default payment terms</legend>
            <div className="mt-1 flex flex-wrap gap-2">
              {[["0", "On receipt"], ["7", "7 days"], ["14", "14 days"], ["30", "30 days"]].map(([v, l]) => (
                <label key={v} className={cx("inline-flex min-h-10 cursor-pointer items-center rounded-full border px-4 text-sm font-medium", terms === v ? "border-deep bg-deep text-white" : "border-line hover:bg-soft")}>
                  <input type="radio" name="termsDays" value={v} checked={terms === v} onChange={() => setTerms(v)} className="sr-only" />{l}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="flex flex-col gap-1">
            <label htmlFor="thanks" className="text-sm font-medium">Footer message</label>
            <input id="thanks" name="thanks" defaultValue={s.thanks} maxLength={120} className={inputClass} placeholder="Thank you for your business!" />
          </div>
        </Card>
        {state && (state.ok ? <Alert tone="success">{state.message}</Alert> : <Alert tone="error">{state.error}</Alert>)}
        <div><Button type="submit" size="lg" busy={pending}>Save invoice settings</Button></div>
      </form>

      <Card className="flex items-start gap-4 p-5 sm:p-6">
        <span className={cx("inline-flex size-11 shrink-0 items-center justify-center rounded-2xl", mail.configured ? "bg-soft text-deep" : "bg-warn-bg text-warn")}>
          {mail.configured ? <Mail className="size-5" aria-hidden /> : <MailWarning className="size-5" aria-hidden />}
        </span>
        <div className="text-sm">
          <h2 className="text-base font-semibold">{mail.configured ? "E-mail is connected" : "E-mail is not connected yet"}</h2>
          {mail.configured
            ? <p className="text-muted">Invoices are sent{mail.from ? <> from <strong className="text-ink">{mail.from}</strong></> : ""}. Customer replies go to {s.email ? <strong className="text-ink">{s.email}</strong> : "the e-mail in Business settings"}.</p>
            : <p className="text-muted">Invoices are saved and can be downloaded, but not e-mailed. Your installer sets <code className="rounded bg-mist px-1">SMTP_URL</code> (e.g. from your e-mail provider) and <code className="rounded bg-mist px-1">MAIL_FROM</code> on the server, then restarts it.</p>}
        </div>
      </Card>
    </div>
  );
}
