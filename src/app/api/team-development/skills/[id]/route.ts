import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { requireActor } from "@/server/policy/actor";
import { skillPatchSchema, updateSkill } from "@/server/services/team-skills";

/** PATCH { name?, category?, description?, archived? }: edit or archive a skill. There is no DELETE: a skill is archived, never removed. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const actor = await requireActor();
    const patch = await parseJson(skillPatchSchema, req);
    return NextResponse.json({ skill: await updateSkill(actor, params.id, patch) });
  });
}
