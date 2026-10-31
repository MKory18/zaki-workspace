import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { loadPersonScore } from "@/server/services/team-score";
import { periodKind } from "@/server/services/team-score-io";

/** One person's score with every indicator and the weights. The person reads their own, the owner and the supervisors those in reach; anybody else 404. */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const q = new URL(req.url).searchParams;
    const score = await loadPersonScore(await requireActor(), params.id, { period: q.get("period") ?? undefined, kind: periodKind(q.get("kind")) });
    return NextResponse.json({ score }, { headers: { "cache-control": "no-store" } });
  });
}
