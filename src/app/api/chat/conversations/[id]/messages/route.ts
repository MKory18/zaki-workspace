import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { activeOrgCtx } from "@/server/services/integrations";
import { sendSchema, sendMessage } from "@/server/services/chat";

/** POST: send a message (optionally as a reply). Guests are rejected by the service. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const input = await parseJson(sendSchema, req);
    const ctx = await activeOrgCtx();
    const msg = await sendMessage(ctx, params.id, input);
    return NextResponse.json({ id: msg.id, at: msg.createdAt }, { status: 201 });
  });
}
