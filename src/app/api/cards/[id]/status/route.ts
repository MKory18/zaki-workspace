import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { parseJson } from "@/server/validation";
import { setCardStatus, statusSchema } from "@/server/services/card-status";

/** Move the approval status (a moderator of the space, or the owner). */
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const actor = await requireActor();
    const input = await parseJson(statusSchema, req);
    return NextResponse.json({ card: await setCardStatus(actor, params.id, input.status) });
  });
}
