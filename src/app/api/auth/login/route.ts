import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { audit, startSession, verifyPassword } from "@/server/auth";
import { apiError, withApi } from "@/server/api";
import { clientIp } from "@/server/rate-limit";
import { LoginGuard } from "@/server/login-guard";

const credentialsSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(1).max(200),
});

/** Brute-force guard (policy and reasoning live in login-guard.ts). */
const guard = new LoginGuard();

/** A real cost-12 bcrypt hash of a throw-away value: unknown e-mails cost the same time as known ones. */
const DUMMY_HASH = "$2a$12$VeIDbFoPFwHKK1UpCnxtEuyhq/uLZ7Ik6NSvJ3XvcS7gwHexWMDJ2";

export async function POST(req: Request) {
  return withApi(async () => {
    const ip = clientIp(req);
    guard.admitAddress(ip);

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
    const attempt = guard.beginAttempt(ip, email);
    try {
      const user = await db.user.findUnique({
        where: { email },
        select: { id: true, passwordHash: true },
      });
      const passwordOk = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
      if (!user || !passwordOk) {
        await audit("auth.login_failed", { target: email });
        return apiError("auth.required", "invalid_credentials");
      }
      attempt.success();
      await startSession(user.id);
      await audit("auth.login", { actorId: user.id });
      return NextResponse.json({ ok: true });
    } finally {
      attempt.done();
    }
  });
}
