import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { parseJson } from "@/server/validation";
import { moveCard, moveCardSchema } from "@/server/services/cards";

/** Drag and drop: between `previousId` (above) and `nextId` (below). One row is written. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const actor = await requireActor();
    const input = await parseJson(moveCardSchema, req);
    return NextResponse.json(await moveCard(actor, params.id, input));
  });
}
