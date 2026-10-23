import { NextResponse } from "next/server";
import { startSession } from "@/server/auth";
import { apiError, withApi } from "@/server/api";
import { registerSchema } from "@/server/validation";
import { registerOrganization } from "@/server/services/orgs";
import { FixedWindowLimiter, REGISTER_LIMIT, RateLimitedError, clientIp } from "@/server/rate-limit";

const registerLimiter = new FixedWindowLimiter(REGISTER_LIMIT);

/** 410: the endpoint (or the mode) is retired for good, not merely refused for this caller. */
function gone(): NextResponse {
  return NextResponse.json({ error: "gone", message: "auth.registration_closed" }, { status: 410 });
}

/**
 * Create a new organisation with its OWNER. Rate-limited per IP.
 * Joining via code is retired (410).
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
    const result = await registerOrganization(parsed.data);
    await startSession(result.userId);
    return NextResponse.json({ ok: true, next: "/" }, { status: 201 });
  });
}
