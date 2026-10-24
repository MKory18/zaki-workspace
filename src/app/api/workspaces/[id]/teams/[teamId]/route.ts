import { NextResponse } from "next/server";
import { z } from "zod";
import { requireWorkspace } from "@/server/auth";
import { apiError, withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { TeamConflictError, deleteTeam, updateTeam } from "@/server/services/teams";

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    description: z.string().max(500).nullable().optional(),
    leadId: z.string().min(1).nullable().optional(),
  })
  .strict();

/** PATCH: rename, describe, choose the lead (a member of the team). A space manager only. */
export async function PATCH(req: Request, { params }: { params: { id: string; teamId: string } }) {
  return withApi(async () => {
    const ctx = await requireWorkspace(params.id, ["ADMIN", "MEMBER"]);
    const input = await parseJson(patchSchema, req);
    try {
      await updateTeam(ctx, params.id, params.teamId, input);
    } catch (err) {
      if (err instanceof TeamConflictError) return apiError("conflict", err.message);
      throw err;
    }
    return NextResponse.json({ ok: true });
  });
}

/** DELETE: only an empty team (no project, no topic): 409 `teams.not_empty` otherwise. A space manager only. */
export async function DELETE(_req: Request, { params }: { params: { id: string; teamId: string } }) {
  return withApi(async () => {
    const ctx = await requireWorkspace(params.id, ["ADMIN", "MEMBER"]);
    try {
      await deleteTeam(ctx, params.id, params.teamId);
    } catch (err) {
      if (err instanceof TeamConflictError) return apiError("conflict", err.message);
      throw err;
    }
    return NextResponse.json({ ok: true });
  });
}
