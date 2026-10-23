import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { activeOrgCtx, assertOrgManager } from "@/server/services/integrations";
import { configureN8n, disconnectN8n, getN8nStatus, recentEvents } from "@/server/services/n8n";
import { assertNotGuest } from "@/server/services/guest-guard";

const configSchema = z.object({
  // Shape only. Which URLs are acceptable (https, no credentials, public hosts) is decided by
  // configureN8n -> assertPublicHttpsUrl, which answers with a specific n8n.url_* key.
  webhookUrl: z.string().trim().url("n8n.url_invalid").max(500),
  events: z.array(z.string()).max(20).default([]),
  rotateSecret: z.boolean().optional(),
});

/**
 * GET: status + recent outbound/inbound event log. Guests get 403. Whoever holds the
 * `integrations.manage` capability (the owner, admins by default, anybody the owner switched it on
 * for) gets the whole status; everybody else only learns whether n8n is connected (no webhook
 * URL, no event filter). The viewer is passed as a person (`{ userId }`), so the switches decide,
 * not the rank.
 */
export async function GET() {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    assertNotGuest(ctx);
    const [status, events] = await Promise.all([
      getN8nStatus(ctx.orgId, { userId: ctx.userId }),
      recentEvents(ctx.orgId),
    ]);
    return NextResponse.json({ status, events });
  });
}

/** POST: configure webhook URL + event filter (`integrations.manage`). */
export async function POST(req: Request) {
  return withApi(async () => {
    const input = await parseJson(configSchema, req);
    const ctx = await activeOrgCtx();
    await assertOrgManager(ctx.orgId);
    const result = await configureN8n(ctx.orgId, input);
    return NextResponse.json(result);
  });
}

/** DELETE: remove the n8n connection entirely. */
export async function DELETE() {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    await assertOrgManager(ctx.orgId);
    await disconnectN8n(ctx.orgId);
    return NextResponse.json({ ok: true });
  });
}
