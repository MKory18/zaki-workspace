import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { requireActor } from "@/server/policy/actor";
import { loadPersonSkills, personSkillSchema, setPersonSkill } from "@/server/services/team-skills";

/**
 * One person's skills, the supervisor's level and their own estimate side by side. GET: the person, their supervisors and the
 * owner (404 for anybody else). PUT { skillId, level 0-4, note, source: MANUAL | SELF }: MANUAL needs the owner or `people.review`
 * for somebody in one's subtree; SELF is the person's own estimate about themselves.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => NextResponse.json({ skills: await loadPersonSkills(await requireActor(), params.id) }, { headers: { "cache-control": "no-store" } }));
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const actor = await requireActor();
    const input = await parseJson(personSkillSchema, req);
    return NextResponse.json(await setPersonSkill(actor, params.id, input));
  });
}
