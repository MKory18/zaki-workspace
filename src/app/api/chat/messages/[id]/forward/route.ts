import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { activeOrgCtx } from "@/server/services/integrations";
import { forwardMessage, forwardSchema } from "@/server/chat/messages";

/** POST: forward a message to another conversation the viewer may read AND post in. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const input = await parseJson(forwardSchema, req);
    const ctx = await activeOrgCtx();
    const result = await forwardMessage(ctx, params.id, input);
    return NextResponse.json(result, { status: 201 });
  });
}
