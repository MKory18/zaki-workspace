import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { parseJson } from "@/server/validation";
import { orderSchema, reorderAttachments } from "@/server/services/card-attachments";

/** The new order of the gallery: exactly the card's attachments, each once. */
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const actor = await requireActor();
    const input = await parseJson(orderSchema, req);
    return NextResponse.json({ gallery: await reorderAttachments(actor, params.id, input.ids) });
  });
}
