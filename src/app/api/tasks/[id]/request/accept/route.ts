import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTaskAccess, audit } from "@/server/auth";
import { withApi } from "@/server/api";
import { answerAssignRequest } from "@/server/services/task-assign";

/**
 * POST: the person a task was ASKED of (or the OWNER) accepts: the task becomes theirs and the requester is told.
 * The rank rule and the rest are in src/server/services/task-assign.ts; this only opens the task (its space and team).
 */
const schema = z.object({ requestId: z.string().min(1).max(100).optional() });

export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    // the body is optional (older callers send none): a task with several pending requests names the one it answers
    const input = schema.safeParse(await req.json().catch(() => ({})));
    const ctx = await requireTaskAccess(params.id);
    const result = await answerAssignRequest(ctx, params.id, { accept: true }, input.success ? input.data.requestId : undefined);
    await audit("task.assign_accepted", { actorId: ctx.userId, orgId: ctx.orgId, target: params.id });
    return NextResponse.json(result);
  });
}
