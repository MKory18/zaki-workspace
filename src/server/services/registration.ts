import * as crypto from "node:crypto";
import { db } from "@/server/db";
import { log } from "@/server/log";
import { appUrl } from "@/server/env";
import { hashPassword, NotFoundError, ForbiddenError } from "@/server/auth";
import { mailConfigured, sendMail } from "@/server/mail";
import { RateLimitedError } from "@/server/rate-limit";
import { registerOrganization, type ProfileFields, type RegisterOrgInput } from "@/server/services/orgs";

/**
 * Opening a company is open to anyone (owner's decision 23/10), behind three guards:
 *
 * 1. **The address is checked.** A request only stores a `PendingRegistration` and mails a one-time
 *    link; the company and its owner are created when the link is confirmed. Nothing signs in before.
 * 2. **One answer for every address.** A known address gets the same reply as a new one (and a mail
 *    telling its owner somebody tried); the password is hashed and a row is written either way, so
 *    neither the reply nor its timing says whether the address has an account.
 * 3. **A cap for the whole server**, on top of the per-address limit in the route: requests per hour
 *    and per day, counted in the database (so it holds across processes).
 */

export const REGISTRATION_LINK_TTL_MS = 24 * 3600_000;

function envCount(name: string, fallback: number): number {
  const n = Number((process.env[name] ?? "").trim());
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/** Read on every request (tests and Coolify can change them without a rebuild). */
export function registrationCaps(): { perHour: number; perDay: number } {
  return { perHour: envCount("REGISTER_GLOBAL_PER_HOUR", 30), perDay: envCount("REGISTER_GLOBAL_PER_DAY", 100) };
}

/** The server cannot send the confirmation mail (SMTP not set): the route answers 503. */
export class RegistrationUnavailableError extends Error {
  constructor() {
    super("auth.registration_unavailable");
    this.name = "RegistrationUnavailableError";
  }
}

const sha256 = (value: string): string => crypto.createHash("sha256").update(value).digest("hex");

/** Mail failures are logged, never shown: the reply must not differ between addresses. */
async function deliver(to: string, subject: string, text: string): Promise<void> {
  try {
    await sendMail({ to, subject, text });
  } catch (err) {
    log.error("mail.send_failed", { kind: "registration", detail: err instanceof Error ? err.message.slice(0, 120) : "unknown" });
  }
}

export async function requestRegistration(input: RegisterOrgInput & ProfileFields): Promise<void> {
  if (!mailConfigured()) throw new RegistrationUnavailableError();
  const email = input.email.toLowerCase().trim();
  const passwordHash = await hashPassword(input.password); // the same work for a known address

  const now = Date.now();
  const caps = registrationCaps();
  const [lastHour, lastDay] = await Promise.all([
    db.pendingRegistration.count({ where: { createdAt: { gte: new Date(now - 3600_000) } } }),
    db.pendingRegistration.count({ where: { createdAt: { gte: new Date(now - 24 * 3600_000) } } }),
  ]);
  if (lastHour >= caps.perHour) throw new RateLimitedError(3600, "auth.registration_busy");
  if (lastDay >= caps.perDay) throw new RateLimitedError(24 * 3600, "auth.registration_busy");

  const token = crypto.randomBytes(32).toString("base64url");
  const known = await db.user.findUnique({ where: { email }, select: { id: true } });
  // a new request replaces the address's older link; the row is written for a known address too
  // (it can never be confirmed: its token is never sent), so the cap counts every attempt
  await db.$transaction([
    db.pendingRegistration.deleteMany({ where: { email } }),
    db.pendingRegistration.create({
      data: {
        email,
        name: input.name,
        jobTitle: input.jobTitle ?? null,
        orgName: input.orgName,
        passwordHash,
        tokenHash: sha256(token),
        expiresAt: new Date(now + REGISTRATION_LINK_TTL_MS),
      },
    }),
  ]);

  const base = appUrl();
  if (known) {
    await deliver(
      email,
      "محاولة إنشاء شركة ببريدك على Zaki Workspace",
      [
        "في حدا طلب يفتح شركة جديدة على Zaki Workspace بهالبريد، بس إلك حساب فيه من قبل.",
        "",
        `إذا إنت، ادخل من هون: ${base}/login`,
        "وإذا نسيت كلمة المرور، اطلب من مالك شركتك يعيّنلك وحدة جديدة.",
        "",
        "إذا مش إنت، تجاهل هالرسالة. ما تغيّر شي بحسابك.",
      ].join("\n"),
    );
    return;
  }
  await deliver(
    email,
    "أكّد بريدك لتفتح شركتك على Zaki Workspace",
    [
      "أهلًا،",
      "",
      "حتى نكمّل فتح شركتك على Zaki Workspace، افتح هالرابط خلال 24 ساعة واضغط «تأكيد»:",
      `${base}/register/confirm?token=${token}`,
      "",
      "إذا مش إنت اللي طلب، تجاهل هالرسالة وما رح ينعمل شي.",
    ].join("\n"),
  );
}

/**
 * The link was opened and «تأكيد» pressed: create the company and its owner, once. The pending row
 * is removed BEFORE the company is made, so a second press (or a second tab) finds nothing.
 */
export async function confirmRegistration(token: string): Promise<{ userId: string }> {
  const row = token ? await db.pendingRegistration.findUnique({ where: { tokenHash: sha256(token) } }) : null;
  if (!row || row.expiresAt.getTime() <= Date.now()) throw new NotFoundError("auth.registration_link_invalid");
  const { count } = await db.pendingRegistration.deleteMany({ where: { id: row.id } });
  if (count === 0) throw new NotFoundError("auth.registration_link_invalid");
  try {
    return await registerOrganization({
      email: row.email,
      name: row.name,
      orgName: row.orgName,
      passwordHash: row.passwordHash,
      ...(row.jobTitle ? { jobTitle: row.jobTitle } : {}),
    });
  } catch (err) {
    // the address got an account meanwhile (another confirmation, or the owner of a company made one)
    if (err instanceof ForbiddenError && err.message === "email.taken") throw new NotFoundError("auth.registration_link_invalid");
    throw err;
  }
}

/** Expired requests, removed by the hourly purge job. */
export async function purgeExpiredRegistrations(): Promise<number> {
  const { count } = await db.pendingRegistration.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return count;
}
