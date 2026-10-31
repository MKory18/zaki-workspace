import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { requireActor } from "@/server/policy/actor";
import { goalPatchSchema, updateGoal } from "@/server/services/team-plans";

/** PATCH a goal: a supervisor edits it, changes its status or accepts a proposal; the person edits or cancels their own proposal. No DELETE. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const actor = await requireActor();
    const patch = await parseJson(goalPatchSchema, req);
    return NextResponse.json({ goal: await updateGoal(actor, params.id, patch) });
  });
}
