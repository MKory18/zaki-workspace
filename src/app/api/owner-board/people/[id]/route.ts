import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { boardAccess } from "@/server/policy/board";
import { loadPerson } from "@/server/services/owner-board";
import { parseBoardQuery } from "@/server/services/owner-board-io";

/**
 * «لوحة المالك» — one person's days, tasks (titles), steps and message COUNTS. Their own page for whoever holds `board.self`;
 * somebody else's only inside the viewer's reach (owner: everybody; `board.team`: the people of the spaces they manage).
 * Outside it: 404, never 403. Reading writes nothing.
 */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const access = await boardAccess(await requireActor());
    return NextResponse.json({ view: await loadPerson(access, params.id, parseBoardQuery(new URL(req.url).searchParams)) }, { headers: { "cache-control": "no-store" } });
  });
}
