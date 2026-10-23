import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { activeOrgCtx } from "@/server/services/integrations";
import { listOversight } from "@/server/chat/oversight";

/** GET: the owner's list of every conversation (a silent look; the look is itself audited). */
export async function GET(req: Request) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    const url = new URL(req.url);
    const spaceId = url.searchParams.get("spaceId") ?? undefined;
    const cursor = url.searchParams.get("cursor") ?? undefined;
    const limitRaw = url.searchParams.get("limit");
    const limit = limitRaw ? Math.min(Math.max(Number(limitRaw) || 0, 1), 100) : undefined;
    const page = await listOversight(ctx, { spaceId, cursor, limit });
    return NextResponse.json(page);
  });
}
