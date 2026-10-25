import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { currentSpace } from "@/server/services/current-space";
import { activeOrgCtx } from "@/server/services/integrations";
import { chatHome } from "@/server/chat/home";
import { ensureStarterTopics } from "@/server/chat/space-topics";

/** GET: the chat home — my spaces with their topics, my DMs, the owner's doors. */
export async function GET() {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    // the space the person is in: its topics only (and the DMs)
    const space = await currentSpace({ userId: ctx.userId, orgId: ctx.orgId, role: ctx.orgRole });
    // a space made before every space got its starter topics gets them the first time its chat opens
    if (space) await ensureStarterTopics(ctx.orgId, space.id);
    const home = await chatHome(ctx, { spaceId: space?.id ?? null });
    return NextResponse.json(home);
  });
}
