import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { activeOrgCtx } from "@/server/services/integrations";
import { leaveCall } from "@/server/calls/calls";

/** POST: the person left the call's page — the call ends when nobody is left in it. */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    await leaveCall(ctx, params.id);
    return NextResponse.json({ ok: true });
  });
}
