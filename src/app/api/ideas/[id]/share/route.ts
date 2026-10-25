import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { ideaAccessCtx, shareIdea } from "@/server/services/ideas";

const shareSchema = z.object({ shared: z.boolean() });

/** POST `{ shared }`: «شارك مع الشركة» or take it back (its author, or the managers of its space). */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await ideaAccessCtx(params.id);
    const input = await parseJson(shareSchema, req);
    const idea = await shareIdea(ctx.orgId, ctx, ctx.orgRole, params.id, input.shared);
    return NextResponse.json({ idea });
  });
}
