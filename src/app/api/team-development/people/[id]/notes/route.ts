import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { requireActor } from "@/server/policy/actor";
import { addNote, listNotes, noteInputSchema } from "@/server/services/team-plans";

/** The 1:1 notes of one person: owner and supervisors read all of them, the person only the ones marked shared. POST adds one (owner, or `people.review` in the subtree). */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => NextResponse.json({ notes: await listNotes(await requireActor(), params.id) }, { headers: { "cache-control": "no-store" } }));
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const actor = await requireActor();
    const input = await parseJson(noteInputSchema, req);
    return NextResponse.json({ note: await addNote(actor, params.id, input) }, { status: 201 });
  });
}
