import { NextResponse } from "next/server";
import { requireActor } from "@/server/policy/actor";
import { withApprovalsApi } from "@/server/approvals-api";
import { approvalsGate, eligibleApprovers, notFound, spaceViewer } from "@/server/services/approval-access";

/**
 * GET ?workspaceId=  the people who may be asked in a space: everybody who works in it (staff, ACTIVE, the owner included),
 * whatever their rank — the requester is left out, nobody approves their own request. A person who does not work in the
 * space gets 404.
 */
export async function GET(req: Request) {
  return withApprovalsApi(async () => {
    const actor = await requireActor();
    await approvalsGate(actor);
    const workspaceId = new URL(req.url).searchParams.get("workspaceId") ?? "";
    if (!(await spaceViewer(actor, workspaceId)).sees) throw notFound();
    const people = (await eligibleApprovers(actor.orgId, workspaceId)).filter((p) => p.id !== actor.userId);
    return NextResponse.json({ approvers: people });
  });
}
