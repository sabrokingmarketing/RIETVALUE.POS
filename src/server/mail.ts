import "server-only";
import nodemailer from "nodemailer";

/** Sends mail through SMTP_URL if configured; otherwise writes to the server log. */
export async function sendMail(to: string, subject: string, text: string): Promise<void> {
  const url = process.env.SMTP_URL;
  if (!url) {
    console.info(`[mail:not-configured] To: ${to}\nSubject: ${subject}\n${text}`);
    return;
  }
  const transport = nodemailer.createTransport(url);
  await transport.sendMail({ from: process.env.MAIL_FROM || undefined, to, subject, text });
}
