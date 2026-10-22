import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { setSessionCookie } from "@/server/auth";
import { apiError, withApi } from "@/server/api";
import { registerSchema } from "@/server/validation";
import { joinByCode, registerOrganization } from "@/server/services/orgs";
import { dispatchEvent } from "@/server/services/n8n";
import { FixedWindowLimiter, REGISTER_LIMIT, RateLimitedError, clientIp } from "@/server/rate-limit";

const registerLimiter = new FixedWindowLimiter(REGISTER_LIMIT);

/** Bootstrap (create org, OWNER) or self-serve join (invitation code, MEMBER). */
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
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(
        "validation.failed",
        undefined,
        parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      );
    }
    const result =
      parsed.data.mode === "join"
        ? await joinByCode(parsed.data).then(async (join) => {
            await dispatchEvent(join.orgId, "member.joined", { userId: join.userId });
            return join;
          })
        : await registerOrganization(parsed.data);
    await setSessionCookie(result.userId);
    return NextResponse.json({ ok: true }, { status: 201 });
  });
}
