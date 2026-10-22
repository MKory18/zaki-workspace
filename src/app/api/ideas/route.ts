import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { parseJson, ideaStatuses } from "@/server/validation";
import { ForbiddenError, type OrgAccessContext } from "@/server/auth";
import { requireActor } from "@/server/policy/actor";
import { createIdea, listIdeas } from "@/server/services/ideas";
import { dispatchEvent } from "@/server/services/n8n";

const createSchema = z.object({
  title: z.string().trim().min(3).max(140),
  description: z.string().max(2000).nullable().optional(),
});

const querySchema = z.object({
  status: z.enum(ideaStatuses).optional(),
  mine: z.coerce.boolean().optional(),
});

/**
 * The caller's active org = their oldest ACTIVE membership (a suspended or removed one never
 * counts). Ideas have noWorkspace nesting; they belong to the organization itself.
 */
async function ideasCtx(): Promise<OrgAccessContext> {
  const actor = await requireActor();
  return { orgId: actor.orgId, orgRole: actor.role, userId: actor.userId };
}

async function writerCtx(): Promise<OrgAccessContext> {
  const ctx = await ideasCtx();
  // GUESTs are read-only across the workspace; ideas follow the same rule.
  if (ctx.orgRole === "GUEST") throw new ForbiddenError("guest.readonly");
  return ctx;
}

/** READ: every org member (incl. guests). */
export async function GET(req: Request) {
  return withApi(async () => {
    const url = new URL(req.url);
    const q = querySchema.parse(Object.fromEntries(url.searchParams.entries()));
    const ctx = await ideasCtx();
    const ideas = await listIdeas(ctx.orgId, { status: q.status, mine: q.mine, viewerId: ctx.userId, external: ctx.orgRole === "GUEST" });
    return NextResponse.json({ ideas });
  });
}

/** WRITE: members+ (never guests). */
export async function POST(req: Request) {
  return withApi(async () => {
    const input = await parseJson(createSchema, req);
    const ctx = await writerCtx();
    const idea = await createIdea(ctx.orgId, ctx, input);
    await dispatchEvent(ctx.orgId, "idea.created", { ideaId: idea.id, title: idea.title });
    return NextResponse.json({ idea }, { status: 201 });
  });
}
