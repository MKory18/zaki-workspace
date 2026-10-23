import { log } from "@/server/log";

/**
 * Outgoing e-mail, over SMTP (nodemailer). The only sender today is registration's address check.
 *
 * Set in Coolify (all four needed; SMTP_PORT is optional):
 *   SMTP_HOST, SMTP_PORT (587 STARTTLS by default, 465 = TLS from the first byte),
 *   SMTP_USER, SMTP_PASS, MAIL_FROM (e.g. «Zaki Workspace <no-reply@zakiai.io>»).
 *
 * Without them, `mailConfigured()` is false and registration answers 503: a link that never
 * arrives is worse than an honest "not now". Tests (NODE_ENV=test) and local development without
 * SMTP keep the messages in `mailOutbox()` instead of sending; development (only) also logs the
 * message, so whoever runs it locally can follow the link. Production never logs a body: it
 * carries one-time links.
 */

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

const outbox: MailMessage[] = [];

/** Messages kept instead of sent (tests and local development without SMTP). */
export function mailOutbox(): MailMessage[] {
  return outbox;
}

function smtp() {
  const host = (process.env["SMTP_HOST"] ?? "").trim();
  const from = (process.env["MAIL_FROM"] ?? "").trim();
  if (!host || !from) return null;
  const port = Number((process.env["SMTP_PORT"] ?? "").trim() || "587");
  const user = (process.env["SMTP_USER"] ?? "").trim();
  const pass = process.env["SMTP_PASS"] ?? "";
  return { host, port: Number.isFinite(port) && port > 0 ? port : 587, user, pass, from };
}

const keepsMail = (): boolean => process.env["NODE_ENV"] === "test" || (process.env["NODE_ENV"] !== "production" && !smtp());

/** Can this server deliver e-mail (or keep it, in tests and local development)? */
export function mailConfigured(): boolean {
  return keepsMail() || smtp() !== null;
}

let transport: { sendMail: (m: Record<string, unknown>) => Promise<unknown> } | null = null;

/** Sends one message. Throws when it cannot; the caller decides what the person is told. */
export async function sendMail(message: MailMessage): Promise<void> {
  if (keepsMail()) {
    outbox.push(message);
    if (process.env["NODE_ENV"] === "development") log.info("mail.kept_locally", { to: message.to, subject: message.subject, text: message.text });
    return;
  }
  const cfg = smtp();
  if (!cfg) throw new Error("mail.not_configured");
  if (!transport) {
    const nodemailer = await import("nodemailer");
    transport = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.port === 465,
      ...(cfg.user ? { auth: { user: cfg.user, pass: cfg.pass } } : {}),
    });
  }
  await transport.sendMail({ from: cfg.from, to: message.to, subject: message.subject, text: message.text });
}
