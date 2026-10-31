import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { requireActor } from "@/server/policy/actor";
import { addCriterion, criterionInputSchema, listCriteria } from "@/server/services/team-criteria";

/** The criteria a reviewer rates (5 by default, 8 in use at most). GET: every staff member; `?all=1` adds the archived. POST: the owner adds one. */
export async function GET(req: Request) {
  return withApi(async () => {
    const all = new URL(req.url).searchParams.get("all") === "1";
    return NextResponse.json({ criteria: await listCriteria(await requireActor(), { all }) }, { headers: { "cache-control": "no-store" } });
  });
}

export async function POST(req: Request) {
  return withApi(async () => {
    const actor = await requireActor();
    const { name } = await parseJson(criterionInputSchema, req);
    return NextResponse.json({ criterion: await addCriterion(actor, name) }, { status: 201 });
  });
}
