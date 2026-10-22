import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { activeOrgCtx } from "@/server/services/integrations";
import { chatDirectory } from "@/server/services/chat";
import { assertNotGuest } from "@/server/services/guest-guard";

/** GET: chatable org members (recipients picker). The staff directory is closed to guests (403). */
export async function GET() {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    assertNotGuest(ctx, "chat.guest_forbidden");
    const people = await chatDirectory(ctx.orgId);
    return NextResponse.json({
      people: people.filter((p) => p.userId !== ctx.userId),
    });
  });
}
