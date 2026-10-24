import { NextResponse } from "next/server";
import { z } from "zod";
import { requireWorkspace } from "@/server/auth";
import { apiError, withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { TeamConflictError, createTeam, listTeams } from "@/server/services/teams";

/**
 * The teams of a space (src/server/services/teams.ts). GET: a manager sees every team, anybody else the teams
 * they are in, and `canManage` says whether they may change them. POST: a manager opens a team.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await requireWorkspace(params.id);
    return NextResponse.json({ teams: await listTeams(ctx, params.id), canManage: ctx.spaceManager === true });
  });
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(500).nullable().optional(),
  memberIds: z.array(z.string().min(1)).max(200).optional(),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await requireWorkspace(params.id, ["ADMIN", "MEMBER"]);
    const input = await parseJson(createSchema, req);
    try {
      const team = await createTeam(ctx, params.id, input);
      return NextResponse.json({ team }, { status: 201 });
    } catch (err) {
      if (err instanceof TeamConflictError) return apiError("conflict", err.message);
      throw err;
    }
  });
}
