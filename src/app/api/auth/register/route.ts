import { NextResponse } from "next/server";
import { apiError, withApi } from "@/server/api";
import { registerSchema } from "@/server/validation";
import { RegistrationUnavailableError, requestRegistration } from "@/server/services/registration";
import { FixedWindowLimiter, REGISTER_LIMIT, RateLimitedError, clientIp } from "@/server/rate-limit";

const registerLimiter = new FixedWindowLimiter(REGISTER_LIMIT);

/** 410: the endpoint (or the mode) is retired for good, not merely refused for this caller. */
function gone(): NextResponse {
  return NextResponse.json({ error: "gone", message: "auth.registration_closed" }, { status: 410 });
}

/**
 * Ask to open a new company: stores the request and mails a confirmation link (the company and its
 * OWNER are created by /api/auth/register/confirm). Every valid request gets the same 202, whether
 * or not the address already has an account. Rate-limited per IP here, and for the whole server in
 * the service. 503 when this server cannot send mail. Joining via code is retired (410).
 */
export async function POST(req: Request) {
  return withApi(async () => {
    const key = `ip:${clientIp(req)}`;
    const state = registerLimiter.check(key);
    if (!state.ok) throw new RateLimitedError(state.retryAfterSec);
    registerLimiter.hit(key);

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return apiError("validation.failed", "invalid JSON");
    }
    if (typeof body === "object" && body !== null && "joinCode" in body) return gone();

    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(
        "validation.failed",
        undefined,
        parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      );
    }
    if (parsed.data.mode === "join") return gone();
    try {
      await requestRegistration(parsed.data);
    } catch (err) {
      if (err instanceof RegistrationUnavailableError) {
        return NextResponse.json({ error: "unavailable", message: err.message }, { status: 503 });
      }
      throw err;
    }
    return NextResponse.json({ ok: true, next: "/register/check-email" }, { status: 202 });
  });
}
