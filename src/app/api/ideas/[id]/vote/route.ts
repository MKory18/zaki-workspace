import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { ForbiddenError } from "@/server/auth";
import { ideaAccessCtx, toggleIdeaVote } from "@/server/services/ideas";

/** Toggle the caller's upvote. Members+ only (guests read-only). */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await ideaAccessCtx(params.id);
    if (ctx.orgRole === "GUEST") throw new ForbiddenError("guest.readonly");
    const res = await toggleIdeaVote(ctx.orgId, ctx, params.id);
    return NextResponse.json(res);
  });
}
