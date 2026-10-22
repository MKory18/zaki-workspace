import { NextResponse } from "next/server";
import { startSession } from "@/server/auth";
import { apiError, withApi } from "@/server/api";
import { registerSchema } from "@/server/validation";
import { registerOrganization, registrationOpen } from "@/server/services/orgs";
import { FixedWindowLimiter, REGISTER_LIMIT, RateLimitedError, clientIp } from "@/server/rate-limit";

const registerLimiter = new FixedWindowLimiter(REGISTER_LIMIT);

/** 410: the endpoint (or the mode) is retired for good, not merely refused for this caller. */
function gone(): NextResponse {
  return NextResponse.json({ error: "gone", message: "auth.registration_closed" }, { status: 410 });
}

/**
 * First-run bootstrap ONLY: while no organization exists at all, creates the company and its
 * OWNER (fully onboarded) and signs them in. Once any organization exists the answer is
 * 403 `auth.registration_closed` — accounts are created by the owner inside the app.
 * Joining an organization with its invitation code is retired: 410, always.
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
    if (!(await registrationOpen())) return apiError("forbidden", "auth.registration_closed");

    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(
        "validation.failed",
        undefined,
        parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      );
    }
    if (parsed.data.mode === "join") return gone();
    // registerOrganization re-checks under a lock: two simultaneous first runs make ONE company
    const result = await registerOrganization(parsed.data);
    await startSession(result.userId);
    return NextResponse.json({ ok: true, next: "/" }, { status: 201 });
  });
}
