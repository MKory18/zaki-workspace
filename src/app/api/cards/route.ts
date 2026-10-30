import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { parse, parseJson } from "@/server/validation";
import { createCard, createCardSchema, listCards } from "@/server/services/cards";

const querySchema = z.object({
  spaceId: z.string().min(1),
  archived: z.enum(["1", "0"]).optional(),
});

/** The cards of one space (the OWNER alone asks for the archive: `archived=1`). A space that is not the caller's is 404. */
export async function GET(req: Request) {
  return withApi(async () => {
    const actor = await requireActor();
    const q = parse(querySchema, Object.fromEntries(new URL(req.url).searchParams.entries()));
    return NextResponse.json(await listCards(actor, q.spaceId, { archived: q.archived === "1" }));
  });
}

/** A new card at the top of the space's manual order. */
export async function POST(req: Request) {
  return withApi(async () => {
    const actor = await requireActor();
    const input = await parseJson(createCardSchema, req);
    return NextResponse.json({ card: await createCard(actor, input) }, { status: 201 });
  });
}
