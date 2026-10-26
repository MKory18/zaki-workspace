import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { activeOrgCtx } from "@/server/services/integrations";
import { activeCallOf, startConversationCall } from "@/server/calls/calls";

const startSchema = z.object({ video: z.boolean().default(false), ring: z.boolean().default(true) });

/** GET: the call going on in this conversation, or `{ call: null }`. Its readers. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    return NextResponse.json({ call: await activeCallOf(ctx, params.id) });
  });
}

/** POST: start this conversation's call (or get the one going on). Whoever may write here. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    const body = await parseJson(startSchema, req);
    const out = await startConversationCall(ctx, params.id, body);
    return NextResponse.json(out, { status: out.created ? 201 : 200 });
  });
}
