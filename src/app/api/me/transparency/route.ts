import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { requireUser, startSession } from "@/server/auth";
import { acceptTransparency } from "@/server/services/onboarding";

const acceptSchema = z.object({ accept: z.literal(true) });

/**
 * Accept the transparency notice (the onboarding's second step): records the organization's
 * current notice version and the date, then re-issues the session cookie without the "notice
 * pending" flag. Accepting again is harmless: the first date stays, the cookie is refreshed.
 */
export async function POST(req: Request) {
  return withApi(async () => {
    const user = await requireUser({ allowPending: true });
    await parseJson(acceptSchema, req);
    await acceptTransparency(user.id);
    await startSession(user.id, { tv: user.tv });
    return NextResponse.json({ ok: true });
  });
}
