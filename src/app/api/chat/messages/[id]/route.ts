import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { activeOrgCtx } from "@/server/services/integrations";
import { editMessage, editSchema, deleteMessage } from "@/server/chat/messages";

/** PATCH: edit my message (or any, if a space admin); tombstoned and system ones refuse. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const input = await parseJson(editSchema, req);
    const ctx = await activeOrgCtx();
    const msg = await editMessage(ctx, params.id, input);
    return NextResponse.json(msg);
  });
}

/** DELETE: tombstone my message (or any, if a space admin); the body stays for the archive. */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    await deleteMessage(ctx, params.id);
    return NextResponse.json({ ok: true });
  });
}
