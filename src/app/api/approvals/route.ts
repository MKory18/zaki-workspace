import { NextResponse } from "next/server";
import { requireActor } from "@/server/policy/actor";
import { parseJson } from "@/server/validation";
import { withApprovalsApi } from "@/server/approvals-api";
import { approvalsGate } from "@/server/services/approval-access";
import { amountOf, createBodySchema } from "@/server/services/approval-input";
import { createApproval, getApproval, listApprovals } from "@/server/services/approvals";
import { viewOf } from "@/lib/approvals/shared";

/**
 * «طلبات الموافقة».
 *
 *  GET  ?view=mine|waiting|all &workspaceId= &status=   the three lists. «all» is the OWNER's (every request of the company, read
 *       silently) and a space ADMIN's (the spaces they manage); anybody else is refused (403 `approvals.e.all_denied`).
 *  POST { workspaceId, title, details?, amount?|amountMinor?, currency?, approverIds[1..3], link?, fileIds? }   ask for a decision.
 *       The files are chat uploads (`POST /api/chat/uploads`, which sniffs the bytes) of the requester; the first approver is told.
 *
 * Switched off (`approvals` in «الميزات»): 404 for everybody. A guest: 403 `guest.no_access`. An approval only records a decision.
 */
export async function GET(req: Request) {
  return withApprovalsApi(async () => {
    const actor = await requireActor();
    await approvalsGate(actor);
    const q = new URL(req.url).searchParams;
    const approvals = await listApprovals(actor, { view: viewOf(q.get("view")), workspaceId: q.get("workspaceId") || null, status: q.get("status") });
    return NextResponse.json({ approvals });
  });
}

export async function POST(req: Request) {
  return withApprovalsApi(async () => {
    const actor = await requireActor();
    await approvalsGate(actor);
    const body = await parseJson(createBodySchema, req);
    const amount = amountOf(body);
    const made = await createApproval(actor, {
      workspaceId: body.workspaceId,
      title: body.title,
      details: body.details,
      amountMinor: amount.amountMinor,
      currency: amount.currency,
      approverIds: body.approverIds,
      link: body.link ?? null,
      fileIds: body.fileIds,
    });
    return NextResponse.json({ approval: await getApproval(actor, made.id) }, { status: 201 });
  });
}
