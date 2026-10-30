import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTaskAccess, audit } from "@/server/auth";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { answerAssignRequest } from "@/server/services/task-assign";

const schema = z.object({
  reason: z.string().trim().min(1, "taskreq.reason_required").max(500),
  /** A task may hold several pending requests (one per higher person): the one this answers. Optional. */
  requestId: z.string().min(1).max(100).optional(),
});

/**
 * POST: the person a task was ASKED of (or the OWNER) returns it, with a written reason: the task stays as it was and the
 * requester gets the reason. See src/server/services/task-assign.ts.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const input = await parseJson(schema, req);
    const ctx = await requireTaskAccess(params.id);
    const result = await answerAssignRequest(ctx, params.id, { accept: false, reason: input.reason }, input.requestId);
    await audit("task.assign_returned", { actorId: ctx.userId, orgId: ctx.orgId, target: params.id });
    return NextResponse.json(result);
  });
}
