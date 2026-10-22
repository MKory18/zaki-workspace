import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { ideaAccessCtx, convertIdeaToTask } from "@/server/services/ideas";

const convertSchema = z.object({
  workspaceId: z.string().min(1),
  projectId: z.string().min(1),
  boardId: z.string().min(1),
});

/** Idea → task through the single task service. Creator or org admins; an external partner gets 403 `guest.no_access` from `ideaAccessCtx`. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await ideaAccessCtx(params.id);
    const input = await parseJson(convertSchema, req);
    const res = await convertIdeaToTask(ctx.orgId, ctx, ctx.orgRole, params.id, input);
    return NextResponse.json(res);
  });
}
