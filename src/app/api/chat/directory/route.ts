import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { activeOrgCtx } from "@/server/services/integrations";
import { chatDirectory } from "@/server/services/chat";

/** GET: chatable org members (recipients picker; guests excluded). */
export async function GET() {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    const people = await chatDirectory(ctx.orgId);
    return NextResponse.json({
      people: people.filter((p) => p.userId !== ctx.userId),
    });
  });
}
