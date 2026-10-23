import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { ideaAccessCtx, toggleIdeaVote } from "@/server/services/ideas";

/** Toggle the caller's upvote. Staff only: `ideaAccessCtx` answers an external partner 403 `guest.no_access`. */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await ideaAccessCtx(params.id);
    const res = await toggleIdeaVote(ctx.orgId, ctx, params.id);
    return NextResponse.json(res);
  });
}
