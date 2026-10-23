import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { activeOrgCtx } from "@/server/services/integrations";
import { assertOversightRead } from "@/server/chat/oversight";
import { conversationDetail } from "@/server/chat/topics";

/** GET: read one conversation AS the owner (silent: no read mark, no event — the service enforces it). */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    const info = await assertOversightRead(ctx, params.id);
    const detail = await conversationDetail(ctx, params.id);
    return NextResponse.json({ ...detail, oversight: { kind: info.kind, spaceId: info.spaceId } });
  });
}
