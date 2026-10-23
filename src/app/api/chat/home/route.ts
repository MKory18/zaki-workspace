import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { activeOrgCtx } from "@/server/services/integrations";
import { chatHome } from "@/server/chat/home";

/** GET: the chat home — my spaces with their topics, my DMs, the owner's doors. */
export async function GET() {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    const home = await chatHome(ctx);
    return NextResponse.json(home);
  });
}
