import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { activeOrgCtx } from "@/server/services/integrations";
import { addNote, noteSchema } from "@/server/chat/messages";

/** POST: an internal note on a message (space admins and the owner only). */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const input = await parseJson(noteSchema, req);
    const ctx = await activeOrgCtx();
    await addNote(ctx, params.id, input);
    return NextResponse.json({ ok: true }, { status: 201 });
  });
}
