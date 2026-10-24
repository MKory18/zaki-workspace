import { NextResponse } from "next/server";
import { z } from "zod";
import { requireWorkspace } from "@/server/auth";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { setTeamMembers } from "@/server/services/teams";

const schema = z
  .object({
    add: z.array(z.string().min(1)).max(200).optional(),
    remove: z.array(z.string().min(1)).max(200).optional(),
  })
  .refine((v) => Boolean(v.add?.length || v.remove?.length), { message: "ws.no_change" });

/**
 * POST: people in and out of a team. Only people of the space may join; somebody who leaves hands back the open
 * tasks they held in the team's projects. A space manager only.
 */
export async function POST(req: Request, { params }: { params: { id: string; teamId: string } }) {
  return withApi(async () => {
    const ctx = await requireWorkspace(params.id, ["ADMIN", "MEMBER"]);
    const input = await parseJson(schema, req);
    return NextResponse.json(await setTeamMembers(ctx, params.id, params.teamId, input));
  });
}
