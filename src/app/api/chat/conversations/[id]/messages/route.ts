import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { activeOrgCtx } from "@/server/services/integrations";
import { sendMessage, sendSchema } from "@/server/chat/messages";

/** POST: send a message (optionally as a reply, with attachments, idempotent on `clientId`). */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const input = await parseJson(sendSchema, req);
    const ctx = await activeOrgCtx();
    const msg = await sendMessage(ctx, params.id, input);
    return NextResponse.json(msg, { status: 201 });
  });
}
