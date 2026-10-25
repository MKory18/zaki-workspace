import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { activeOrgCtx } from "@/server/services/integrations";
import { removeFromCall } from "@/server/calls/calls";

const schema = z.object({ userId: z.string().min(1).max(64) });

/** POST: take somebody out of the call (the caller, the moderators, the owner). */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    const body = await parseJson(schema, req);
    await removeFromCall(ctx, params.id, body.userId);
    return NextResponse.json({ ok: true });
  });
}
