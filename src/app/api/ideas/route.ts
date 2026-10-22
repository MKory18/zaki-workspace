import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { parseJson, ideaStatuses } from "@/server/validation";
import type { OrgAccessContext } from "@/server/auth";
import { requireActor } from "@/server/policy/actor";
import { assertNotGuest } from "@/server/services/guest-guard";
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
 *
 * Ideas are the team's own (every idea names its author): staff only. An external partner (guest)
 * gets 403 `guest.no_access` from every handler, before the query string or the body is looked at.
 */
async function ideasCtx(): Promise<OrgAccessContext> {
  const actor = await requireActor();
  assertNotGuest({ orgRole: actor.role });
  return { orgId: actor.orgId, orgRole: actor.role, userId: actor.userId };
}

/** READ: every member of the team (never a guest). */
export async function GET(req: Request) {
  return withApi(async () => {
    const ctx = await ideasCtx();
    const url = new URL(req.url);
    const q = querySchema.parse(Object.fromEntries(url.searchParams.entries()));
    const ideas = await listIdeas(ctx.orgId, { status: q.status, mine: q.mine, viewerId: ctx.userId, external: ctx.orgRole === "GUEST" });
    return NextResponse.json({ ideas });
  });
}

/** WRITE: members+ (never guests). */
export async function POST(req: Request) {
  return withApi(async () => {
    const ctx = await ideasCtx();
    const input = await parseJson(createSchema, req);
    const idea = await createIdea(ctx.orgId, ctx, input);
    await dispatchEvent(ctx.orgId, "idea.created", { ideaId: idea.id, title: idea.title });
    return NextResponse.json({ idea }, { status: 201 });
  });
}
