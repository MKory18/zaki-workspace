import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { requireActor } from "@/server/policy/actor";
import { setNoteShared } from "@/server/services/team-plans";

/** PATCH { shared: boolean }: share a note with the person, or take it back (its author, or the owner). A note is never edited or deleted. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const actor = await requireActor();
    const { shared } = await parseJson(z.object({ shared: z.boolean() }), req);
    return NextResponse.json({ note: await setNoteShared(actor, params.id, shared) });
  });
}
