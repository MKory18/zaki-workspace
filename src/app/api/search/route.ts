import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { requireUser } from "@/server/auth";
import { withApi } from "@/server/api";
import { ForbiddenError } from "@/server/auth";
import { accessibleWorkspaceIds } from "@/server/services/access";

/** Strip LIKE wildcards so user input is a literal substring. */
function sanitize(q: string): string {
  return q.replace(/[%_\\]/g, " ").trim().slice(0, 80);
}

/**
 * Search over the tasks/projects of the workspaces the caller can open.
 * Authorization is enforced in SQL by the same rule every other view uses
 * (`accessibleWorkspaceIds`: org OWNER/ADMIN inherit their org's workspaces,
 * everyone else only the workspaces they were put in) — never client-side.
 */
export async function GET(req: Request) {
  return withApi(async () => {
    const user = await requireUser();
    const url = new URL(req.url);
    const q = sanitize(url.searchParams.get("q") ?? "");
    if (q.length < 2) return NextResponse.json({ tasks: [], projects: [] });

    const memberships = await db.organizationMember.findMany({
      where: { userId: user.id },
      select: { organizationId: true },
    });
    const orgIds = memberships.map((m) => m.organizationId);
    if (orgIds.length === 0) throw new ForbiddenError("not_org_member");

    const workspaceIds = await accessibleWorkspaceIds(user.id);
    if (workspaceIds.length === 0) return NextResponse.json({ tasks: [], projects: [] });

    const contains = { contains: q, mode: "insensitive" as const };

    const [tasks, projects] = await Promise.all([
      db.task.findMany({
        where: {
          orgId: { in: orgIds },
          workspaceId: { in: workspaceIds },
          archived: false,
          title: contains,
        },
        orderBy: [{ updatedAt: "desc" }],
        take: 8,
        select: {
          id: true,
          number: true,
          title: true,
          priority: true,
          organization: { select: { keyPrefix: true } },
          project: { select: { id: true, name: true } },
        },
      }),
      db.project.findMany({
        where: {
          workspaceId: { in: workspaceIds },
          name: contains,
        },
        orderBy: [{ createdAt: "desc" }],
        take: 6,
        select: {
          id: true,
          name: true,
          workspace: { select: { id: true, name: true } },
        },
      }),
    ]);

    return NextResponse.json({
      tasks: tasks.map((t) => ({
        id: t.id,
        key: `${t.organization.keyPrefix}-${t.number}`,
        title: t.title,
        priority: t.priority,
        projectId: t.project.id,
        projectName: t.project.name,
      })),
      projects: projects.map((p) => ({
        id: p.id,
        name: p.name,
        workspaceId: p.workspace.id,
        workspaceName: p.workspace.name,
      })),
    });
  });
}
