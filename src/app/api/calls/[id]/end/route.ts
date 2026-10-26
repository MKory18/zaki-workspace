import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { activeOrgCtx } from "@/server/services/integrations";
import { endCall } from "@/server/calls/calls";

/** POST: end the call for everybody («إنهاء للكل»). A host only; everybody else leaves. */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    await endCall(ctx, params.id);
    return NextResponse.json({ ok: true });
  });
}
