import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { activeOrgCtx } from "@/server/services/integrations";
import { muteInSpace, muteSchema } from "@/server/chat/moderation";

/** POST: mute (or unmute with `until: null`) one person in one space. Space admins only. */
export async function POST(req: Request, { params }: { params: { spaceId: string } }) {
  return withApi(async () => {
    const input = await parseJson(muteSchema, req);
    const ctx = await activeOrgCtx();
    const result = await muteInSpace(ctx, params.spaceId, input);
    return NextResponse.json(result);
  });
}
