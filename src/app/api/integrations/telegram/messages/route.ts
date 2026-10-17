import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { activeOrgCtx } from "@/server/services/integrations";
import { chatMessages } from "@/server/services/telegram";

const querySchema = z.object({
  chatId: z.string().min(1).max(64),
});

/** GET ?chatId=… : message thread of one chat (read-only, guests included). */
export async function GET(req: Request) {
  return withApi(async () => {
    const url = new URL(req.url);
    const q = querySchema.parse(Object.fromEntries(url.searchParams.entries()));
    const ctx = await activeOrgCtx();
    const messages = await chatMessages(ctx.orgId, q.chatId);
    return NextResponse.json({ messages: messages.reverse() }); // oldest first for the thread view
  });
}
