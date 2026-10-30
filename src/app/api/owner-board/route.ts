import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { boardAccess } from "@/server/policy/board";
import { loadOverview } from "@/server/services/owner-board";
import { parseBoardQuery } from "@/server/services/owner-board-io";

/**
 * «لوحة المالك» — the people table, the cards and the «اليوم» strip, as JSON (counts and task-free numbers only).
 *
 *  GET ?range=today|7|14|30 | ?from=YYYY-MM-DD&to=YYYY-MM-DD (at most 92 days) &space=<id> &person=<id> &sort=<column> &dir=asc|desc
 *
 * The owner reads everybody; a person holding `board.team` the people in their reach; anybody else gets 404 (a person who holds
 * only `board.self` has no overview: their page is /api/owner-board/people/<own id>). Reading writes nothing.
 */
export async function GET(req: Request) {
  return withApi(async () => {
    const access = await boardAccess(await requireActor());
    return NextResponse.json({ overview: await loadOverview(access, parseBoardQuery(new URL(req.url).searchParams)) }, { headers: { "cache-control": "no-store" } });
  });
}
