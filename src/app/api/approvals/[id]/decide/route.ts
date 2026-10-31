import { NextResponse } from "next/server";
import { requireActor } from "@/server/policy/actor";
import { parseJson } from "@/server/validation";
import { withApprovalsApi } from "@/server/approvals-api";
import { approvalsGate } from "@/server/services/approval-access";
import { decideBodySchema } from "@/server/services/approval-input";
import { decideApproval, getApproval } from "@/server/services/approvals";

/**
 * POST { decision: "APPROVE" | "REJECT" | "CHANGES", reason? }  the named approver whose turn it is. A rejection and a request for
 * changes need a written reason (422). Exactly once: a decision that lost the race, or one on a request that moved on, is 409.
 * Not the approver: 403 (404 for somebody who may not read it). The owner reading silently is not an approver unless named.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApprovalsApi(async () => {
    const actor = await requireActor();
    await approvalsGate(actor);
    const body = await parseJson(decideBodySchema, req);
    await decideApproval(actor, params.id, { decision: body.decision, reason: body.reason });
    return NextResponse.json({ approval: await getApproval(actor, params.id) });
  });
}
