import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { activeOrgCtx } from "@/server/services/integrations";
import { markDelivered } from "@/server/chat/messages";

/** POST: mark a DM delivered (DM members only; the service refuses everything else). */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    await markDelivered(ctx, params.id);
    return NextResponse.json({ ok: true });
  });
}
