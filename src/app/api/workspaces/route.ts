import { NextResponse } from "next/server";
import { z } from "zod";
import { audit, requireOrgRole, requireUser } from "@/server/auth";
import { withApi } from "@/server/api";
import { db } from "@/server/db";
import { parseJson } from "@/server/validation";
import { createWorkspace } from "@/server/services/workspaces";
import { accessibleWorkspaceIds } from "@/server/services/access";

/** Workspace switcher — only workspaces the caller may open (org admins inherit all). */
export async function GET() {
  return withApi(async () => {
    const user = await requireUser();
    const orgs = await db.organizationMember.findMany({
      where: { userId: user.id },
      select: {
        role: true,
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
          select: { id: true, name: true, slug: true, organizationId: true },
          orderBy: { name: "asc" },
        })
      : [];
    const byOrg = new Map<string, { id: string; name: string; slug: string }[]>();
    for (const w of workspaces) {
      const list = byOrg.get(w.organizationId) ?? [];
      list.push({ id: w.id, name: w.name, slug: w.slug });
      byOrg.set(w.organizationId, list);
    }
    return NextResponse.json({
      organizations: orgs.map((m) => ({
        id: m.organization.id,
        name: m.organization.name,
        keyPrefix: m.organization.keyPrefix,
        role: m.role,
        workspaces: byOrg.get(m.organization.id) ?? [],
      })),
    });
  });
}

const createSchema = z.object({
  organizationId: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).optional(),
});

/** Creates a workspace inside an organization the caller administers. */
export async function POST(req: Request) {
  return withApi(async () => {
    const input = await parseJson(createSchema, req);
    const ctx = await requireOrgRole(input.organizationId, ["OWNER", "ADMIN"]);
    const workspace = await createWorkspace(ctx.userId, {
      organizationId: input.organizationId,
      name: input.name,
      description: input.description ?? null,
    });
    await audit("workspace.created", {
      actorId: ctx.userId,
      orgId: ctx.orgId,
      target: workspace.id,
      meta: { name: workspace.name },
    });
    return NextResponse.json({ workspace }, { status: 201 });
  });
}
