import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { activeOrgCtx } from "@/server/services/integrations";
import { markRead } from "@/server/chat/messages";

/** POST: mark the conversation read up to now (or `?upTo=<messageId>`); never backwards. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    const upTo = new URL(req.url).searchParams.get("upTo") ?? undefined;
    const result = await markRead(ctx, params.id, upTo);
    return NextResponse.json(result);
  });
}
