import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { activeOrgCtx, assertOrgManager } from "@/server/services/integrations";
import { clearGoogleApp, saveGoogleApp } from "@/server/services/google";

const appSchema = z.object({
  clientId: z.string().trim().min(1).max(200),
  clientSecret: z.string().trim().min(1).max(200),
});

/**
 * POST: the Google app's id and secret, typed on «الأتمتة» (src/server/services/google.ts, `saveGoogleApp`). Whoever
 * runs integrations (`integrations.manage`). The secret is stored encrypted and is never sent back.
 */
export async function POST(req: Request) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    await assertOrgManager(ctx.orgId);
    const input = await parseJson(appSchema, req);
    await saveGoogleApp(ctx.orgId, ctx.userId, input);
    return NextResponse.json({ ok: true });
  });
}

/** DELETE: forget the app typed on the site. */
export async function DELETE() {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    await assertOrgManager(ctx.orgId);
    await clearGoogleApp(ctx.orgId, ctx.userId);
    return NextResponse.json({ ok: true });
  });
}
