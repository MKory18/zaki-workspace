import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { activeOrgCtx } from "@/server/services/integrations";
import { reactSchema, toggleReact } from "@/server/chat/messages";

/** POST: toggle a reaction on a message (a single emoji, at most twelve distinct per message). */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const input = await parseJson(reactSchema, req);
    const ctx = await activeOrgCtx();
    const result = await toggleReact(ctx, params.id, input);
    return NextResponse.json(result);
  });
}
