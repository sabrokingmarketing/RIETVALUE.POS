import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import nodemailer from "nodemailer";

export type MailAttachment = { filename: string; content: Buffer | Uint8Array; contentType: string; cid?: string };
export type MailMessage = { to: string; subject: string; text: string; html?: string; replyTo?: string; attachments?: MailAttachment[] };
export type MailOutcome = "sent" | "not_configured";

/** True when real e-mail delivery (or test capture) is configured. */
export function mailConfigured(): boolean {
  return !!(process.env.SMTP_URL || process.env.MAIL_CAPTURE_DIR);
}

/**
 * Sends mail through SMTP_URL. With MAIL_CAPTURE_DIR set instead (tests, demos), each message is
 * written there as JSON. With neither, the message is only logged and "not_configured" is returned.
 * Throws when the mail server refuses the message.
 */
export async function deliver(msg: MailMessage): Promise<MailOutcome> {
  const attachments = msg.attachments?.map((a) => ({ filename: a.filename, content: Buffer.from(a.content), contentType: a.contentType, cid: a.cid }));
  if (process.env.SMTP_URL) {
    const transport = nodemailer.createTransport(process.env.SMTP_URL, { connectionTimeout: 15_000, socketTimeout: 30_000 } as never);
    await transport.sendMail({ from: process.env.MAIL_FROM || undefined, to: msg.to, replyTo: msg.replyTo || undefined, subject: msg.subject, text: msg.text, html: msg.html, attachments });
    return "sent";
  }
  if (process.env.MAIL_CAPTURE_DIR) {
    const dir = path.resolve(/*turbopackIgnore: true*/ process.env.MAIL_CAPTURE_DIR);
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
    await fs.writeFile(file, JSON.stringify({
      to: msg.to, replyTo: msg.replyTo, subject: msg.subject, text: msg.text, html: msg.html,
      attachments: attachments?.map((a) => ({ filename: a.filename, contentType: a.contentType, size: a.content.length, base64: a.content.toString("base64") })),
    }));
    return "sent";
  }
  console.info(`[mail:not-configured] To: ${msg.to}\nSubject: ${msg.subject}\n${msg.text}`);
  return "not_configured";
}

/** Plain-text mail (password resets etc.). */
export async function sendMail(to: string, subject: string, text: string): Promise<void> {
  await deliver({ to, subject, text });
}
