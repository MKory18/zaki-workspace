import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { activeOrgCtx } from "@/server/services/integrations";
import { joinTopic } from "@/server/chat/topics";

/** POST: «شارك بالمحادثة» — the owner joins a topic so he may post in it. */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    const result = await joinTopic(ctx, params.id);
    return NextResponse.json(result);
  });
}
