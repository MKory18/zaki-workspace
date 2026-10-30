import { NextResponse } from "next/server";
import { requireTaskAccess, audit } from "@/server/auth";
import { withApi } from "@/server/api";
import { answerAssignRequest } from "@/server/services/task-assign";

/**
 * POST: the person a task was ASKED of (or the OWNER) accepts: the task becomes theirs and the requester is told.
 * The rank rule and the rest are in src/server/services/task-assign.ts; this only opens the task (its space and team).
 */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await requireTaskAccess(params.id);
    const result = await answerAssignRequest(ctx, params.id, { accept: true });
    await audit("task.assign_accepted", { actorId: ctx.userId, orgId: ctx.orgId, target: params.id });
    return NextResponse.json(result);
  });
}
