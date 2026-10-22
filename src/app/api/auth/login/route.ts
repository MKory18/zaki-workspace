import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { audit, setSessionCookie, verifyPassword } from "@/server/auth";
import { apiError, withApi } from "@/server/api";
import { FixedWindowLimiter, LOGIN_LIMITS, RateLimitedError, clientIp } from "@/server/rate-limit";
import { log } from "@/server/log";

const credentialsSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(1).max(200),
});

/**
 * Brute-force guard. Two independent limits:
 *  - per address: every attempt counts (generous; an office shares one address);
 *  - per account: only FAILED attempts count, for known and unknown e-mails alike,
 *    and a good sign-in clears it. Guessing from many addresses therefore still hits the wall.
 */
const ipLimiter = new FixedWindowLimiter(LOGIN_LIMITS.perIp);
const accountLimiter = new FixedWindowLimiter(LOGIN_LIMITS.perAccount);

/** A real cost-12 bcrypt hash of a throw-away value: unknown e-mails cost the same time as known ones. */
const DUMMY_HASH = "$2a$12$VeIDbFoPFwHKK1UpCnxtEuyhq/uLZ7Ik6NSvJ3XvcS7gwHexWMDJ2";

export async function POST(req: Request) {
  return withApi(async () => {
    const ip = clientIp(req);
    const ipKey = `ip:${ip}`;
    const ipState = ipLimiter.check(ipKey);
    if (!ipState.ok) {
      log.warn("auth.login_blocked", { by: "ip", ip });
      throw new RateLimitedError(ipState.retryAfterSec);
    }
    ipLimiter.hit(ipKey);

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return apiError("validation.failed", "invalid JSON");
    }
    const parsed = credentialsSchema.safeParse(body);
    if (!parsed.success) return apiError("auth.required", "invalid_credentials");

    const { password } = parsed.data;
    const email = parsed.data.email.toLowerCase();
    const accountKey = `acct:${email}`;
    const accountState = accountLimiter.check(accountKey);
    if (!accountState.ok) {
      log.warn("auth.login_blocked", { by: "account", ip });
      throw new RateLimitedError(accountState.retryAfterSec);
    }

    const user = await db.user.findUnique({
      where: { email },
      select: { id: true, passwordHash: true },
    });
    const passwordOk = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !passwordOk) {
      accountLimiter.hit(accountKey);
      await audit("auth.login_failed", { target: email });
      return apiError("auth.required", "invalid_credentials");
    }
    accountLimiter.reset(accountKey);
    await setSessionCookie(user.id);
    await audit("auth.login", { actorId: user.id });
    return NextResponse.json({ ok: true });
  });
}
