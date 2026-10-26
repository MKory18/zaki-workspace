import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { activeOrgCtx } from "@/server/services/integrations";
import { muteInCall } from "@/server/calls/calls";

const schema = z.object({ userId: z.string().min(1).max(64) });

/** POST: mute somebody's microphone in the call («اكتم»). A host only. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    const body = await parseJson(schema, req);
    await muteInCall(ctx, params.id, body.userId);
    return NextResponse.json({ ok: true });
  });
}
