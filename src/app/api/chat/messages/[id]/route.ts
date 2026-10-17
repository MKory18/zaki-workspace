import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { activeOrgCtx } from "@/server/services/integrations";
import { editMessage, deleteMessage } from "@/server/services/chat";

const patchSchema = z.object({
  body: z.string().trim().min(1, "chat.empty_message").max(4000),
});

/** PATCH: edit my message (or any, if group admin). Tombstoned ones refuse. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const input = await parseJson(patchSchema, req);
    const ctx = await activeOrgCtx();
    await editMessage(ctx, params.id, input.body);
    return NextResponse.json({ ok: true });
  });
}

/** DELETE: tombstone my message (or any, if group admin); row kept for thread replies. */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    await deleteMessage(ctx, params.id);
    return NextResponse.json({ ok: true });
  });
}
