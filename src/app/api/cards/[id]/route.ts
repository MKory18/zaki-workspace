import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { withCardApi } from "@/server/card-api";
import { requireActor } from "@/server/policy/actor";
import { parseJson } from "@/server/validation";
import { archiveCard, readCard, updateCard, updateCardSchema } from "@/server/services/cards";

type Ctx = { params: { id: string } };

export async function GET(_req: Request, { params }: Ctx) {
  return withApi(async () => {
    const actor = await requireActor();
    return NextResponse.json({ card: await readCard(actor, params.id) });
  });
}

/** Edit: title, text, data, colour, category, tags, pin. `version`: the one the editor started from (409 when the card moved on). */
export async function PATCH(req: Request, { params }: Ctx) {
  return withCardApi(async () => {
    const actor = await requireActor();
    const input = await parseJson(updateCardSchema, req);
    return NextResponse.json({ card: await updateCard(actor, params.id, input) });
  });
}

/** «حذف»: archives the card (nothing is removed; the OWNER still reads it). */
export async function DELETE(_req: Request, { params }: Ctx) {
  return withApi(async () => {
    const actor = await requireActor();
    await archiveCard(actor, params.id);
    return NextResponse.json({ ok: true });
  });
}
