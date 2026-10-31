import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { applyGoal } from "@/server/services/team-plans";

/** POST: the one-click confirm of a DONE goal: writes its target level as the supervisor's level of that skill (history reason `goal:<id>`), once. */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => NextResponse.json(await applyGoal(await requireActor(), params.id)));
}
