import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { activeOrgCtx } from "@/server/services/integrations";
import { loadConversationFacts, loadOrgFacts } from "@/server/policy/conversation";
import { ForbiddenError } from "@/server/auth";
import { searchConversation } from "@/server/chat/search";

/** GET ?q=: the messages of this conversation that carry the words (a guest: topics only, like reading). */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    if ((await loadOrgFacts(ctx.userId, ctx.orgId))?.role === "GUEST" && (await loadConversationFacts(ctx.userId, params.id))?.kind !== "TOPIC") {
      throw new ForbiddenError("chat.guest_forbidden");
    }
    const hits = await searchConversation(ctx, params.id, new URL(req.url).searchParams.get("q") ?? "");
    return NextResponse.json({ hits });
  });
}
