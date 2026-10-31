import { NextResponse } from "next/server";
import { requireActor } from "@/server/policy/actor";
import { parseJson } from "@/server/validation";
import { withApprovalsApi } from "@/server/approvals-api";
import { approvalsGate } from "@/server/services/approval-access";
import { amountOf, resubmitBodySchema } from "@/server/services/approval-input";
import { getApproval, resubmitApproval } from "@/server/services/approvals";
import { resubmitForm } from "@/server/services/approval-forms";

/**
 * POST { title?, details?, amount?|amountMinor?|currency?, approverIds?, link?, fileIds? }  — or, for a request that came from a form,
 * { answers, ... }. The requester edits a request that was sent back («اطلب تعديل») and sends it again: a NEW VERSION, the old one
 * kept with its steps and files; the first approver is told. Only from CHANGES_REQUESTED (409 otherwise).
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApprovalsApi(async () => {
    const actor = await requireActor();
    await approvalsGate(actor);
    const body = await parseJson(resubmitBodySchema, req);
    const amount = amountOf(body);
    const rest = {
      ...(amount.present ? { amountMinor: amount.amountMinor, currency: amount.currency } : {}),
      ...(body.link !== undefined ? { link: body.link } : {}),
      ...(body.fileIds ? { fileIds: body.fileIds } : {}),
      ...(body.approverIds ? { approverIds: body.approverIds } : {}),
    };
    if (body.answers) await resubmitForm(actor, params.id, body.answers, rest);
    else await resubmitApproval(actor, params.id, { ...rest, ...(body.title !== undefined ? { title: body.title } : {}), ...(body.details !== undefined ? { details: body.details } : {}) });
    return NextResponse.json({ approval: await getApproval(actor, params.id) });
  });
}
