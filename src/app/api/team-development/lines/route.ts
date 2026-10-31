import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { loadStructure } from "@/server/services/team-lines";

/**
 * «الهيكل» — who answers to whom, as the viewer may read it: the owner (and whoever holds `people.manage_lines`) the whole
 * company, a supervisor their subtree, anybody else only their own supervisor and the names of their team mates. Names and job
 * titles only. 404 for a guest and while «الأداء والتطوير» is switched off.
 */
export async function GET() {
  return withApi(async () => NextResponse.json({ structure: await loadStructure(await requireActor()) }, { headers: { "cache-control": "no-store" } }));
}
