import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { parseJson } from "@/server/validation";
import { sendCard, sendCardSchema } from "@/server/services/cards";

/** «أرسل»: the card's words as a message in a topic of the same space. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const actor = await requireActor();
    const input = await parseJson(sendCardSchema, req);
    return NextResponse.json(await sendCard(actor, params.id, input.conversationId), { status: 201 });
  });
}
