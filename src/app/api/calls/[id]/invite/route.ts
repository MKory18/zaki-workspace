import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { activeOrgCtx } from "@/server/services/integrations";
import { inviteToCall } from "@/server/calls/calls";

const schema = z.object({ userId: z.string().min(1).max(64) });

/** POST: ring one of the space's people into the call. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    const body = await parseJson(schema, req);
    await inviteToCall(ctx, params.id, body.userId);
    return NextResponse.json({ ok: true });
  });
}
