import { NextResponse } from "next/server";
import { z } from "zod";
import { requireActor } from "@/server/policy/actor";
import { parseJson } from "@/server/validation";
import { withApprovalsApi } from "@/server/approvals-api";
import { approvalsGate } from "@/server/services/approval-access";
import { setFormArchived } from "@/server/services/approval-forms";

const schema = z.object({ archived: z.boolean() }).strict();

/** POST { archived }: a manager archives a form (not offered for filling any more) or brings it back. Nothing is deleted. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApprovalsApi(async () => {
    const actor = await requireActor();
    await approvalsGate(actor);
    const { archived } = await parseJson(schema, req);
    return NextResponse.json(await setFormArchived(actor, params.id, archived));
  });
}
