import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { requireActor } from "@/server/policy/actor";
import { criterionPatchSchema, updateCriterion } from "@/server/services/team-criteria";

/** PATCH { name?, archived? }: the owner renames or retires a criterion. No DELETE: the ratings already given keep their meaning. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const actor = await requireActor();
    const patch = await parseJson(criterionPatchSchema, req);
    return NextResponse.json({ criterion: await updateCriterion(actor, params.id, patch) });
  });
}
