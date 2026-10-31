import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { requireActor } from "@/server/policy/actor";
import { createSkill, listSkills, skillInputSchema } from "@/server/services/team-skills";

/** «المهارات» — GET the checklist (every staff member; `?archived=1` adds the archived ones for who keeps it); POST a new skill (owner, `people.manage_lines`). */
export async function GET(req: Request) {
  return withApi(async () => {
    const includeArchived = new URL(req.url).searchParams.get("archived") === "1";
    return NextResponse.json({ skills: await listSkills(await requireActor(), { includeArchived }) }, { headers: { "cache-control": "no-store" } });
  });
}

export async function POST(req: Request) {
  return withApi(async () => {
    const actor = await requireActor();
    const input = await parseJson(skillInputSchema, req);
    return NextResponse.json({ skill: await createSkill(actor, input) }, { status: 201 });
  });
}
