import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { activeOrgCtx, assertOrgManager } from "@/server/services/integrations";
import { sendTestPayload } from "@/server/services/n8n";

/** POST: fire a signed test event through the exact production delivery path. */
export async function POST() {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    await assertOrgManager(ctx.orgId);
    const result = await sendTestPayload(ctx.orgId);
    return NextResponse.json(result, { status: result.delivered ? 200 : 400 });
  });
}
