import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { requireActor } from "@/server/policy/actor";
import { createGoal, goalInputSchema, listGoals } from "@/server/services/team-plans";

/** «خطة التطوير» of one person. GET: the person, their supervisors, the owner. POST: a supervisor writes a goal; the person writes a proposal («اقتراح»). */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => NextResponse.json({ goals: await listGoals(await requireActor(), params.id) }, { headers: { "cache-control": "no-store" } }));
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const actor = await requireActor();
    const input = await parseJson(goalInputSchema, req);
    return NextResponse.json({ goal: await createGoal(actor, params.id, input) }, { status: 201 });
  });
}
