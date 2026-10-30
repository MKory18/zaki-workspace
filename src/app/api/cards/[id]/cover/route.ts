import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { parseJson } from "@/server/validation";
import { coverSchema, setCover } from "@/server/services/card-attachments";

/** The cover picture (a library picture of this space), or null for none. */
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const actor = await requireActor();
    const input = await parseJson(coverSchema, req);
    return NextResponse.json(await setCover(actor, params.id, input.fileId));
  });
}
