import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { AppError } from "./errors";
import { assertRole, type Actor } from "./session-types";
import { emailInput, getInvoice, recordEmail, type Invoice } from "./invoices";
import { invoiceTitle } from "@/lib/invoice-format";
import { renderInvoicePdf, shortDate } from "./invoice-pdf";
import { deliver, type MailAttachment } from "./mail";
import { getSettings } from "./settings";
import { uploadDir } from "./uploads";
import { formatRand } from "@/lib/money";
import { log } from "./log";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const nl2br = (s: string) => esc(s).replace(/\n/g, "<br>");

export function invoiceFileName(inv: Pick<Invoice, "invoice_no" | "vat_registered">) {
  return `${inv.vat_registered ? "Tax-invoice" : "Invoice"}-${inv.invoice_no ?? "draft"}.pdf`;
}

/** Plain-text and HTML bodies. All customer- and staff-entered text is escaped. */
export function invoiceEmailBody(inv: Invoice, message: string, hasLogo: boolean) {
  const b = inv.business_snapshot;
  const title = invoiceTitle(inv);
  const paid = inv.status === "paid";
  const greeting = inv.bill_name && !inv.bill_name.includes("@") ? `Hi ${inv.bill_name.split(/\s+/)[0]},` : "Hi,";
  const lead = paid
    ? `Thank you for your purchase at ${b.business_name}. Your ${title.toLowerCase()} ${inv.invoice_no} for ${formatRand(inv.total_cents)} is attached — it is paid in full.`
    : `Please find attached ${title.toLowerCase()} ${inv.invoice_no} from ${b.business_name} for ${formatRand(inv.total_cents)}${inv.due_date && inv.due_date !== inv.issue_date ? `, due on ${shortDate(inv.due_date)}` : ""}.`;
  const text = [greeting, "", lead, ...(message ? ["", message] : []), ...(!paid && inv.payment_info ? ["", "How to pay:", inv.payment_info] : []),
    "", b.thanks || "Thank you for your business!", "", b.business_name, ...(b.phone ? [`Tel ${b.phone}`] : []), ...(b.email ? [b.email] : [])].join("\n");

  const rows: [string, string][] = [
    [`${title} no.`, inv.invoice_no ?? "—"], ["Date", shortDate(inv.issue_date)],
    ...(paid ? [["Status", "Paid"] as [string, string]] : inv.due_date ? [["Due", shortDate(inv.due_date)] as [string, string]] : []),
    ...(inv.reference ? [["Reference", inv.reference] as [string, string]] : []),
  ];
  const html = `<!doctype html><html><body style="margin:0;background:#F7F9F6;font-family:Poppins,Segoe UI,Helvetica,Arial,sans-serif;color:#17211B">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F7F9F6;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #E5E7EB;border-radius:16px;overflow:hidden">
<tr><td style="background:#365314;height:6px;font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td style="padding:24px 28px 8px">
  ${hasLogo ? `<img src="cid:logo" alt="${esc(b.business_name)}" height="64" style="display:block;height:64px;max-width:220px;margin-bottom:10px">` : ""}
  <div style="font-size:18px;font-weight:700;color:#365314">${esc(b.business_name)}</div>
</td></tr>
<tr><td style="padding:8px 28px 0;font-size:15px;line-height:1.6">
  <p style="margin:0 0 12px">${esc(greeting)}</p>
  <p style="margin:0 0 16px">${esc(lead)}</p>
  ${message ? `<p style="margin:0 0 16px">${nl2br(message)}</p>` : ""}
</td></tr>
<tr><td style="padding:0 28px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ECFCCB;border-radius:12px">
    <tr><td style="padding:16px 18px">
      <div style="font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#365314;font-weight:600">${paid ? "Amount paid" : "Amount due"}</div>
      <div style="font-size:28px;font-weight:700;color:#17211B">${esc(formatRand(inv.total_cents))}</div>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:8px;font-size:13px;color:#17211B">
        ${rows.map(([k, v]) => `<tr><td style="padding:2px 16px 2px 0;color:#647067">${esc(k)}</td><td style="padding:2px 0;font-weight:600">${esc(v)}</td></tr>`).join("")}
      </table>
    </td></tr>
  </table>
</td></tr>
${!paid && inv.payment_info ? `<tr><td style="padding:16px 28px 0;font-size:13px;line-height:1.6"><div style="font-weight:600;margin-bottom:4px">How to pay</div><div style="color:#17211B">${nl2br(inv.payment_info)}</div></td></tr>` : ""}
<tr><td style="padding:16px 28px 24px;font-size:13px;color:#647067;line-height:1.6">The ${esc(title.toLowerCase())} is attached as a PDF.</td></tr>
<tr><td style="background:#365314;padding:16px 28px;color:#ffffff;font-size:13px;line-height:1.6">
  <strong>${esc(b.thanks || "Thank you for your business!")}</strong><br>
  <span style="color:#D9F99D">${[b.phone && `Tel ${esc(b.phone)}`, b.email && esc(b.email)].filter(Boolean).join(" &middot; ")}</span>
</td></tr>
</table></td></tr></table></body></html>`;
  return { text, html, subject: `${title} ${inv.invoice_no} from ${b.business_name}` };
}

export type EmailResult = { status: "sent" | "failed" | "not_configured"; to: string; error?: string };

/** E-mails the invoice PDF and logs the attempt. A delivery failure is reported, not thrown. */
export async function sendInvoiceEmail(actor: Actor, invoiceId: string, input: { to: string; message?: string }): Promise<EmailResult> {
  assertRole(actor, ["owner", "cashier"]);
  const r = emailInput.safeParse({ to: input.to, message: input.message ?? "" });
  if (!r.success) throw new AppError("VALIDATION", r.error.issues[0].message);
  const inv = await getInvoice(actor, invoiceId);
  if (!inv) throw new AppError("NOT_FOUND", "That invoice was not found.");
  if (inv.status === "draft") throw new AppError("CONFLICT", "Issue the invoice before e-mailing it.");
  if (inv.status === "void") throw new AppError("CONFLICT", "This invoice is void and can't be sent.");
  const settings = await getSettings();
  const pdf = await renderInvoicePdf(inv, { logoFile: settings.logo_file });
  const attachments: MailAttachment[] = [{ filename: invoiceFileName(inv), content: pdf, contentType: "application/pdf" }];
  let hasLogo = false;
  if (/^[0-9a-f-]{36}\.(png|jpg)$/.test(settings.logo_file)) {
    try {
      const content = await fs.readFile(path.join(/*turbopackIgnore: true*/ uploadDir(), settings.logo_file));
      attachments.push({ filename: `logo.${settings.logo_file.split(".").pop()}`, content, contentType: settings.logo_file.endsWith(".png") ? "image/png" : "image/jpeg", cid: "logo" });
      hasLogo = true;
    } catch { /* fall back to the built-in emblem */ }
  }
  if (!hasLogo) {
    try {
      const content = await fs.readFile(path.join(process.cwd(), "public", "brand", "emblem.png"));
      attachments.push({ filename: "logo.png", content, contentType: "image/png", cid: "logo" });
      hasLogo = true;
    } catch { /* text header only */ }
  }
  const body = invoiceEmailBody(inv, r.data.message, hasLogo);
  try {
    const outcome = await deliver({ to: r.data.to, subject: body.subject, text: body.text, html: body.html, replyTo: inv.business_snapshot.email || undefined, attachments });
    await recordEmail(inv.id, r.data.to, outcome, "", actor);
    return { status: outcome, to: r.data.to };
  } catch (e) {
    const msg = (e as Error)?.message ?? "Unknown error";
    log("error", "invoice.email_failed", { invoiceId: inv.id }, e);
    await recordEmail(inv.id, r.data.to, "failed", msg, actor);
    return { status: "failed", to: r.data.to, error: "The mail server did not accept the message. Check the address and try again." };
  }
}
