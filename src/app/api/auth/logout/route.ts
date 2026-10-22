import { NextResponse } from "next/server";
import { audit, clearSessionCookie, currentUser } from "@/server/auth";
import { withApi } from "@/server/api";

/**
 * Sign out of this browser. Works for anybody, including somebody in the middle of the onboarding.
 * The audit row is written only when a VALID session existed (it names who signed out): no cookie,
 * or a cookie that is no longer honoured, clears the cookie and writes nothing, so an anonymous
 * script cannot grow the audit log.
 */
export async function POST() {
  return withApi(async () => {
    const user = await currentUser();
    await clearSessionCookie();
    if (user) await audit("auth.logout", { actorId: user.id });
    return NextResponse.json({ ok: true });
  });
}
