import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { activeOrgCtx } from "@/server/services/integrations";
import { voteSchema, votePoll } from "@/server/chat/polls";

/** PUT: set my vote on a poll — the options I chose (a single-choice poll takes one); none withdraws it. */
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const input = await parseJson(voteSchema, req);
    const ctx = await activeOrgCtx();
    return NextResponse.json(await votePoll(ctx, params.id, input));
  });
}
