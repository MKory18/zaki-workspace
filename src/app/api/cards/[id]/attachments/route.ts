import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { parseJson } from "@/server/validation";
import { addAttachment, attachSchema, listGallery } from "@/server/services/card-attachments";

type Ctx = { params: { id: string } };

export async function GET(_req: Request, { params }: Ctx) {
  return withApi(async () => {
    const actor = await requireActor();
    return NextResponse.json({ gallery: await listGallery(actor, params.id) });
  });
}

/** Add a picture or file the editor already uploaded to the library of this space (the one upload route sniffs it). */
export async function POST(req: Request, { params }: Ctx) {
  return withApi(async () => {
    const actor = await requireActor();
    const input = await parseJson(attachSchema, req);
    return NextResponse.json({ gallery: await addAttachment(actor, params.id, input) }, { status: 201 });
  });
}
