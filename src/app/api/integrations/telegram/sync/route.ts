import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { ForbiddenError } from "@/server/auth";
import { activeOrgCtx } from "@/server/services/integrations";
import { syncUpdates } from "@/server/services/telegram";

/** POST: pull new Telegram updates for the active org (guests read-only). */
export async function POST() {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    if (ctx.orgRole === "GUEST") throw new ForbiddenError("guest.readonly");
    const result = await syncUpdates(ctx.orgId);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json(result);
  });
}
