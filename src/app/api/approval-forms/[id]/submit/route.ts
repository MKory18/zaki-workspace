import { NextResponse } from "next/server";
import { requireActor } from "@/server/policy/actor";
import { parseJson } from "@/server/validation";
import { withApprovalsApi } from "@/server/approvals-api";
import { approvalsGate } from "@/server/services/approval-access";
import { fillBodySchema } from "@/server/services/approval-input";
import { submitForm } from "@/server/services/approval-forms";
import { getApproval } from "@/server/services/approvals";

/**
 * POST { answers, fileIds?, link? }  fill a form: the answers are checked field by field against its latest version, written as
 * labelled lines into a request, and the form's preset chain is asked. 422 names the field and the reason.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApprovalsApi(async () => {
    const actor = await requireActor();
    await approvalsGate(actor);
    const body = await parseJson(fillBodySchema, req);
    const made = await submitForm(actor, params.id, { answers: body.answers, fileIds: body.fileIds, link: body.link ?? null });
    return NextResponse.json({ approval: await getApproval(actor, made.id) }, { status: 201 });
  });
}
