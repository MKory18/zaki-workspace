import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { loadScoreTable } from "@/server/services/team-score";
import { periodKind } from "@/server/services/team-score-io";

/**
 * «الأداء والتطوير» — the people the viewer reads, each with the score band and the light for a period.
 *  GET ?period=2026-10 | 2026-Q4 &kind=month|quarter &sort=name|score
 * Sorted by NAME unless the viewer asks for `sort=score`. The owner reads everybody, a supervisor their subtree; anybody else 404.
 */
export async function GET(req: Request) {
  return withApi(async () => {
    const q = new URL(req.url).searchParams;
    const table = await loadScoreTable(await requireActor(), { period: q.get("period") ?? undefined, kind: periodKind(q.get("kind")), sort: q.get("sort") ?? undefined });
    return NextResponse.json({ table }, { headers: { "cache-control": "no-store" } });
  });
}
