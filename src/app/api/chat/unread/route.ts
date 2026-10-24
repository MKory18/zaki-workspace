import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { activeOrgCtx } from "@/server/services/integrations";
import { unreadTotal } from "@/server/chat/unread";

/** GET: `{ total }`, the unread messages behind «الدردشة» in the menus (one query, polled and pushed live). */
export async function GET() {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    return NextResponse.json({ total: await unreadTotal(ctx) }, { headers: { "Cache-Control": "no-store" } });
  });
}
