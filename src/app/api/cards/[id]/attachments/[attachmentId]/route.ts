import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { parseJson } from "@/server/validation";
import { captionSchema, removeAttachment, setCaption } from "@/server/services/card-attachments";

type Ctx = { params: { id: string; attachmentId: string } };

export async function PATCH(req: Request, { params }: Ctx) {
  return withApi(async () => {
    const actor = await requireActor();
    const input = await parseJson(captionSchema, req);
    return NextResponse.json({ gallery: await setCaption(actor, params.id, params.attachmentId, input.caption) });
  });
}

/** Takes the picture out of the gallery (the file stays in the library). */
export async function DELETE(_req: Request, { params }: Ctx) {
  return withApi(async () => {
    const actor = await requireActor();
    return NextResponse.json({ gallery: await removeAttachment(actor, params.id, params.attachmentId) });
  });
}
