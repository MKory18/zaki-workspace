import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { currentSpace } from "@/server/services/current-space";
import { activeOrgCtx } from "@/server/services/integrations";
import { unreadTotal } from "@/server/chat/unread";

/** GET: `{ total }`, the unread messages behind «الدردشة» in the menus (one query, polled and pushed live). */
export async function GET() {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    // the space the person is in (another space's count is on the space switcher)
    const space = await currentSpace({ userId: ctx.userId, orgId: ctx.orgId, role: ctx.orgRole });
    return NextResponse.json({ total: await unreadTotal(ctx, space?.id ?? null, space?.kind === "HQ") }, { headers: { "Cache-Control": "no-store" } });
  });
}
