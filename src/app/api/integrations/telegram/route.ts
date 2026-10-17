import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { activeOrgCtx, assertOrgManager } from "@/server/services/integrations";
import { connectBot, disconnect, listChats } from "@/server/services/telegram";

const connectSchema = z.object({
  token: z
    .string()
    .trim()
    .regex(/^\d+:[A-Za-z0-9_-]{30,}$/, "telegram.token_shape"),
});

/** GET: bot identity + chat list (members read; guests included). */
export async function GET() {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    const chats = await listChats(ctx.orgId);
    const botUsername = (chats?.config as { botUsername?: string })?.botUsername ?? null;
    return NextResponse.json({ chats, botUsername });
  });
}

/** POST: connect a bot by token — verified against Telegram before storage. */
export async function POST(req: Request) {
  return withApi(async () => {
    const input = await parseJson(connectSchema, req);
    const ctx = await activeOrgCtx();
    await assertOrgManager(ctx.orgId);
    const result = await connectBot(ctx.orgId, input.token);
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true, botUsername: result.username });
  });
}

/** DELETE: disconnect and drop the encrypted token. */
export async function DELETE() {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    await assertOrgManager(ctx.orgId);
    await disconnect(ctx.orgId);
    return NextResponse.json({ ok: true });
  });
}
