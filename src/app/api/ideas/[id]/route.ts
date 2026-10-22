import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { parseJson, ideaStatuses } from "@/server/validation";
import {
  deleteIdea,
  updateIdea,
  ideaAccessCtx,
} from "@/server/services/ideas";
import { dispatchEvent } from "@/server/services/n8n";

const patchSchema = z.object({
  title: z.string().trim().min(3).max(140).optional(),
  description: z.string().max(2000).nullable().optional(),
  status: z.enum(ideaStatuses).optional(),
});

// `ideaAccessCtx` is the door: an external partner (guest) gets 403 `guest.no_access` from it, before
// the body is looked at (ideas are the team's own).

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await ideaAccessCtx(params.id);
    const input = await parseJson(patchSchema, req);
    const idea = await updateIdea(ctx.orgId, ctx, ctx.orgRole, params.id, input);
    if (input.status && idea.status === input.status) {
      const event = input.status === "ACCEPTED" ? "idea.accepted" : input.status === "REJECTED" ? "idea.rejected" : null;
      if (event) await dispatchEvent(ctx.orgId, event, { ideaId: idea.id, title: idea.title });
    }
    return NextResponse.json({ idea });
  });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await ideaAccessCtx(params.id);
    await deleteIdea(ctx.orgId, ctx, ctx.orgRole, params.id);
    return NextResponse.json({ ok: true });
  });
}
