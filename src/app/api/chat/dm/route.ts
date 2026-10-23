import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { activeOrgCtx } from "@/server/services/integrations";
import { openDm } from "@/server/chat/dm";

const dmSchema = z.object({ userId: z.string().min(1) });

/** POST: open (or find) the DM between me and one person. Guests have no DMs. */
export async function POST(req: Request) {
  return withApi(async () => {
    const input = await parseJson(dmSchema, req);
    const ctx = await activeOrgCtx();
    const result = await openDm(ctx, input.userId);
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  });
}
