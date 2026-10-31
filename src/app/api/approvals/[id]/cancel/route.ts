import { NextResponse } from "next/server";
import { requireActor } from "@/server/policy/actor";
import { withApprovalsApi } from "@/server/approvals-api";
import { approvalsGate } from "@/server/services/approval-access";
import { cancelApproval, getApproval } from "@/server/services/approvals";

/** POST: the requester cancels a request that is being decided (or was sent back). A status, never a deletion. */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  return withApprovalsApi(async () => {
    const actor = await requireActor();
    await approvalsGate(actor);
    await cancelApproval(actor, params.id);
    return NextResponse.json({ approval: await getApproval(actor, params.id) });
  });
}
