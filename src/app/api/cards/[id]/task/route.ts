import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { parseJson } from "@/server/validation";
import { cardTaskSchema, cardToTask } from "@/server/services/cards";

/** «حوّلها لمهمة»: a task in a project of the card's own space. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const actor = await requireActor();
    const input = await parseJson(cardTaskSchema, req);
    return NextResponse.json(await cardToTask(actor, params.id, input), { status: 201 });
  });
}
