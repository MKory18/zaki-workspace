import { NextResponse } from "next/server";
import { requireActor } from "@/server/policy/actor";
import { parseJson } from "@/server/validation";
import { withApprovalsApi } from "@/server/approvals-api";
import { approvalsGate } from "@/server/services/approval-access";
import { formBodySchema } from "@/server/services/approval-input";
import { getForm, updateForm } from "@/server/services/approval-forms";

/** GET: one form (its latest version, with its fields). PUT { name, description?, schema, baseVersion? }: an edit writes the NEXT version (409 when somebody edited first). */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withApprovalsApi(async () => {
    const actor = await requireActor();
    await approvalsGate(actor);
    return NextResponse.json({ form: await getForm(actor, params.id) });
  });
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  return withApprovalsApi(async () => {
    const actor = await requireActor();
    await approvalsGate(actor);
    const body = await parseJson(formBodySchema, req);
    await updateForm(actor, params.id, { name: body.name, description: body.description, schema: body.schema, baseVersion: body.baseVersion });
    return NextResponse.json({ form: await getForm(actor, params.id) });
  });
}
