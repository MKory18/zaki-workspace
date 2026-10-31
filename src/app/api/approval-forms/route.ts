import { NextResponse } from "next/server";
import { z } from "zod";
import { requireActor } from "@/server/policy/actor";
import { parseJson } from "@/server/validation";
import { withApprovalsApi } from "@/server/approvals-api";
import { approvalsGate } from "@/server/services/approval-access";
import { formBodySchema } from "@/server/services/approval-input";
import { createForm, getForm, listForms } from "@/server/services/approval-forms";

/**
 * «نماذج».
 *
 *  GET  ?workspaceId=   the forms of a space (people who work in it; a manager also sees the archived ones).
 *  POST { workspaceId, name, description?, schema }   a new form: the OWNER and the space's ADMIN. `schema` is
 *       { fields: [{ id, type, label, required, options?, min?, max? }] (1..20), approvers: [userId] (1..3) }; the types are
 *       text, textarea, number, date, choice, yesno. Anything else in it is refused: a form is data, never code.
 */
export async function GET(req: Request) {
  return withApprovalsApi(async () => {
    const actor = await requireActor();
    await approvalsGate(actor);
    const workspaceId = new URL(req.url).searchParams.get("workspaceId") ?? "";
    return NextResponse.json({ forms: await listForms(actor, workspaceId) });
  });
}

const createSchema = formBodySchema.extend({ workspaceId: z.string().min(1).max(64) });

export async function POST(req: Request) {
  return withApprovalsApi(async () => {
    const actor = await requireActor();
    await approvalsGate(actor);
    const body = await parseJson(createSchema, req);
    const made = await createForm(actor, body.workspaceId, { name: body.name, description: body.description, schema: body.schema });
    return NextResponse.json({ form: await getForm(actor, made.familyId) }, { status: 201 });
  });
}
