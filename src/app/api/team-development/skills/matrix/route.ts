import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { loadSkillMatrix } from "@/server/services/team-skills";

/** The people × skills matrix: the owner everybody, a supervisor their subtree; 404 for anybody else. */
export async function GET() {
  return withApi(async () => NextResponse.json({ matrix: await loadSkillMatrix(await requireActor()) }, { headers: { "cache-control": "no-store" } }));
}
