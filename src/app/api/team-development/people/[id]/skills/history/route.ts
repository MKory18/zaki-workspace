import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { loadSkillHistory } from "@/server/services/team-skills";

/** The history of one person's levels (who, when, old to new), newest first; `?skill=<id>` narrows it to one skill. */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const skill = new URL(req.url).searchParams.get("skill") ?? undefined;
    return NextResponse.json({ history: await loadSkillHistory(await requireActor(), params.id, skill) }, { headers: { "cache-control": "no-store" } });
  });
}
