import { NextResponse } from "next/server";
import { z } from "zod";
import { audit, ForbiddenError, requireUser } from "@/server/auth";
import { withApi } from "@/server/api";
import { db } from "@/server/db";
import { notifyMembership } from "@/server/notify";
import { assertCan, requireActor } from "@/server/policy/actor";
import { can, effectiveCapabilities } from "@/server/policy/capabilities";
import { parseJson } from "@/server/validation";
import { createWorkspace } from "@/server/services/workspaces";
import { accessibleWorkspaceIds } from "@/server/services/access";

/**
 * Workspace switcher — only the spaces the caller may open: the OWNER sees every space of the
 * company, everybody else (an ADMIN included) only the spaces they are in, and only while their
 * membership is ACTIVE. `canCreateSpaces` says whether they may open a new one in that organization.
 */
export async function GET() {
  return withApi(async () => {
    const user = await requireUser();
    const orgs = await db.organizationMember.findMany({
      where: { userId: user.id, status: "ACTIVE" },
      orderBy: { createdAt: "asc" },
      select: {
        role: true,
        capabilities: true,
        revokedCapabilities: true,
        organization: {
          select: {
            id: true,
            name: true,
            keyPrefix: true,
          },
        },
      },
    });
    const wsIds = await accessibleWorkspaceIds(user.id);
    const workspaces = wsIds.length
      ? await db.workspace.findMany({
          where: { id: { in: wsIds } },
          select: { id: true, name: true, slug: true, organizationId: true, kind: true },
          orderBy: { name: "asc" },
        })
      : [];
    const byOrg = new Map<string, { id: string; name: string; slug: string; holdsProjects: boolean }[]>();
    for (const w of workspaces) {
      const list = byOrg.get(w.organizationId) ?? [];
      // «الشركة» (HQ) is for announcements and the company's talk: no project is opened there
      list.push({ id: w.id, name: w.name, slug: w.slug, holdsProjects: w.kind !== "HQ" });
      byOrg.set(w.organizationId, list);
    }
    return NextResponse.json({
      organizations: orgs.map((m) => ({
        id: m.organization.id,
        name: m.organization.name,
        keyPrefix: m.organization.keyPrefix,
        role: m.role,
        canCreateSpaces: can(m, "spaces.create"),
        workspaces: byOrg.get(m.organization.id) ?? [],
      })),
    });
  });
}

const createSchema = z.object({
  /** Optional: the organization the caller works in unless they name another one of theirs. */
  organizationId: z.string().min(1).optional(),
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).optional(),
  /** People to put in the new space from the start (ACTIVE members of the same organization). */
  memberIds: z.array(z.string().min(1)).max(200).optional(),
});

/**
 * Opens a space. It needs the capability `spaces.create` (the owner and the admins by default; the owner
 * switches it on for a lead or a member by name, or off for an admin); the creator becomes the space ADMIN.
 */
export async function POST(req: Request) {
  return withApi(async () => {
    const actor = await requireActor();
    const input = await parseJson(createSchema, req);

    // the organization they work in, or another one of theirs when they name it: their rights THERE count
    let orgId = actor.orgId;
    let caps = actor.caps;
    if (input.organizationId && input.organizationId !== actor.orgId) {
      const member = await db.organizationMember.findUnique({
        where: { organizationId_userId: { organizationId: input.organizationId, userId: actor.userId } },
        select: { role: true, status: true, capabilities: true, revokedCapabilities: true },
      });
      if (!member || member.status !== "ACTIVE") throw new ForbiddenError("spaces.wrong_org");
      orgId = input.organizationId;
      caps = effectiveCapabilities(member);
    }
    assertCan({ caps }, "spaces.create");

    const { workspace, added } = await createWorkspace(actor.userId, {
      organizationId: orgId,
      name: input.name,
      description: input.description ?? null,
      memberIds: input.memberIds,
    });
    if (added.length) {
      await notifyMembership({
        userIds: added,
        kind: "workspace",
        title: workspace.name,
        linkUrl: "/projects",
        actorId: actor.userId,
      });
    }
    await audit("workspace.created", {
      actorId: actor.userId,
      orgId,
      target: workspace.id,
      meta: { name: workspace.name },
    });
    return NextResponse.json({ workspace }, { status: 201 });
  });
}
