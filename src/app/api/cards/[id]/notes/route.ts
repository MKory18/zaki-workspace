import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { parseJson } from "@/server/validation";
import { addNote, listNotes, noteSchema } from "@/server/services/card-notes";

type Ctx = { params: { id: string } };

/** The thread: the space's public notes and the viewer's own private ones (nobody else's). */
export async function GET(_req: Request, { params }: Ctx) {
  return withApi(async () => {
    const actor = await requireActor();
    return NextResponse.json(await listNotes(actor, params.id));
  });
}

export async function POST(req: Request, { params }: Ctx) {
  return withApi(async () => {
    const actor = await requireActor();
    const input = await parseJson(noteSchema, req);
    return NextResponse.json({ note: await addNote(actor, params.id, input) }, { status: 201 });
  });
}
