import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { activeOrgCtx } from "@/server/services/integrations";
import { purgeConversation } from "@/server/chat/purge";

/** POST: «حذف نهائي» — the OWNER deletes a topic, a group or a DM with everything in it (src/server/chat/purge.ts). */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    await purgeConversation(ctx, params.id);
    return NextResponse.json({ ok: true });
  });
}
