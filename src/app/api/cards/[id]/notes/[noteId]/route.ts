import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { parseJson } from "@/server/validation";
import { deleteNote, editNote, editNoteSchema } from "@/server/services/card-notes";

type Ctx = { params: { id: string; noteId: string } };

/** The author changes the words of their note. */
export async function PATCH(req: Request, { params }: Ctx) {
  return withApi(async () => {
    const actor = await requireActor();
    const input = await parseJson(editNoteSchema, req);
    return NextResponse.json({ note: await editNote(actor, params.id, params.noteId, input.body) });
  });
}

/** «حذف»: the author, or a moderator for a public note. The row stays. */
export async function DELETE(_req: Request, { params }: Ctx) {
  return withApi(async () => {
    const actor = await requireActor();
    await deleteNote(actor, params.id, params.noteId);
    return NextResponse.json({ ok: true });
  });
}
