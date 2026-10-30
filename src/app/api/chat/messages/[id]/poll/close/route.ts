import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { activeOrgCtx } from "@/server/services/integrations";
import { closePoll } from "@/server/chat/polls";

/** POST: close a poll now — its creator or a moderator of the topic. */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    return NextResponse.json(await closePoll(ctx, params.id));
  });
}
