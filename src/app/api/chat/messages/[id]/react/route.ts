import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { activeOrgCtx } from "@/server/services/integrations";
import { toggleReact } from "@/server/services/chat";

const reactSchema = z.object({ emoji: z.string().trim().min(1).max(16) });

/** POST: toggle one of the six allowed reactions on a message. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const input = await parseJson(reactSchema, req);
    const ctx = await activeOrgCtx();
    const result = await toggleReact(ctx, params.id, input.emoji);
    return NextResponse.json(result);
  });
}
