import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { ForbiddenError } from "@/server/auth";
import { activeOrgCtx } from "@/server/services/integrations";
import { sendMessage } from "@/server/services/telegram";

const sendSchema = z.object({
  chatId: z.string().min(1).max(64),
  text: z.string().trim().min(1).max(4000),
});

/** POST: send from the connected bot to one chat (members+, never guests). */
export async function POST(req: Request) {
  return withApi(async () => {
    const input = await parseJson(sendSchema, req);
    const ctx = await activeOrgCtx();
    if (ctx.orgRole === "GUEST") throw new ForbiddenError("guest.readonly");
    const result = await sendMessage(ctx.orgId, input.chatId, input.text);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  });
}
