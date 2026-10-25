import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { isSpaceManager } from "@/server/workspace-role";

/**
 * TEAMS INSIDE A SPACE — the one place that says which projects and tasks a person may see.
 *
 * The owner's decision (2026-10-25, «اعزل كل مساحة عمل»): a space can be split into teams, each with its own
 * projects (and chat topics). Inside such a space a person sees
 *   - the space's own work: projects with no team, and their tasks;
 *   - the work of the teams they are in;
 *   - everything, if they manage the space (`isSpaceManager`: the org OWNER, the space's ADMIN, an org ADMIN
 *     who is in it).
 * A space with NO team is unchanged: everybody in it sees all of it, exactly as before teams existed.
 *
 * Every list reads through `projectVisibleWhere` / `taskVisibleWhere`; every single row through
 * `canSeeProject` (or `requireProjectAccess` / `requireTaskAccess` in src/server/auth.ts). A miss is "not
 * found", never "forbidden", so a link to another team's work does not even say it exists.
 */

export interface WorkScope {
  /** Spaces whose every project the person sees (they manage it, or it has no team at all). */
  full: ReadonlySet<string>;
  /** Spaces the person is in that have teams they do not manage: only the space's own work and their teams'. */
  partial: ReadonlySet<string>;
  /** The person's teams inside the `partial` spaces. */
  teamIds: ReadonlySet<string>;
}

/** Everything a person may open, with the teams taken into account. Three queries. */
export async function loadWorkScope(userId: string): Promise<WorkScope> {
  const memberships = await db.organizationMember.findMany({
    where: { userId, status: "ACTIVE" },
    select: { role: true, organizationId: true },
  });
  const full = new Set<string>();
  const partial = new Set<string>();
  const teamIds = new Set<string>();
  if (memberships.length === 0) return { full, partial, teamIds };

  const orgRole = new Map(memberships.map((m) => [m.organizationId, m.role]));
  const ownedOrgIds = memberships.filter((m) => m.role === "OWNER").map((m) => m.organizationId);
  const [owned, rows] = await Promise.all([
    ownedOrgIds.length ? db.workspace.findMany({ where: { organizationId: { in: ownedOrgIds } }, select: { id: true } }) : Promise.resolve([]),
    db.workspaceMember.findMany({
      where: { userId, workspace: { organizationId: { in: [...orgRole.keys()] } } },
      select: { workspaceId: true, role: true, workspace: { select: { organizationId: true } } },
    }),
  ]);
  for (const w of owned) full.add(w.id);

  const candidates: string[] = [];
  for (const row of rows) {
    if (full.has(row.workspaceId)) continue;
    if (isSpaceManager(orgRole.get(row.workspace.organizationId), row.role)) full.add(row.workspaceId);
    else candidates.push(row.workspaceId);
  }
  if (candidates.length) {
    const teams = await db.team.findMany({
      where: { workspaceId: { in: candidates } },
      select: { id: true, workspaceId: true, members: { where: { userId }, select: { id: true } } },
    });
    const withTeams = new Set(teams.map((t) => t.workspaceId));
    for (const id of candidates) (withTeams.has(id) ? partial : full).add(id);
    for (const t of teams) if (t.members.length) teamIds.add(t.id);
  }
  return { full, partial, teamIds };
}

/**
 * The scope inside ONE space: the space the person is in (src/server/services/current-space.ts). Lists read
 * through it so another space's work never shows; a space outside the scope leaves nothing.
 */
export function narrowScope(scope: WorkScope, spaceId: string | null | undefined): WorkScope {
  const only = (ids: ReadonlySet<string>) => new Set(spaceId && ids.has(spaceId) ? [spaceId] : []);
  return { full: only(scope.full), partial: only(scope.partial), teamIds: scope.teamIds };
}

/** Every space id of the scope (what `accessibleWorkspaceIds` answers). */
export function scopeSpaceIds(scope: WorkScope): string[] {
  return [...scope.full, ...scope.partial];
}

/** Projects the person may see. An empty scope matches nothing. */
export function projectVisibleWhere(scope: WorkScope): Prisma.ProjectWhereInput {
  const or: Prisma.ProjectWhereInput[] = [];
  if (scope.full.size) or.push({ workspaceId: { in: [...scope.full] } });
  if (scope.partial.size) {
    or.push({ workspaceId: { in: [...scope.partial] }, OR: [{ teamId: null }, ...(scope.teamIds.size ? [{ teamId: { in: [...scope.teamIds] } }] : [])] });
  }
  return or.length ? { OR: or } : { id: { in: [] } };
}

/** Tasks the person may see: the task's space and its project's team. */
export function taskVisibleWhere(scope: WorkScope): Prisma.TaskWhereInput {
  const or: Prisma.TaskWhereInput[] = [];
  if (scope.full.size) or.push({ workspaceId: { in: [...scope.full] } });
  if (scope.partial.size) {
    or.push({
      workspaceId: { in: [...scope.partial] },
      project: { OR: [{ teamId: null }, ...(scope.teamIds.size ? [{ teamId: { in: [...scope.teamIds] } }] : [])] },
    });
  }
  return or.length ? { OR: or } : { id: { in: [] } };
}

/** One project (or anything that hangs off one) against the scope. */
export function canSeeProject(scope: WorkScope, project: { workspaceId: string; teamId: string | null }): boolean {
  if (scope.full.has(project.workspaceId)) return true;
  if (!scope.partial.has(project.workspaceId)) return false;
  return project.teamId === null || scope.teamIds.has(project.teamId);
}

/**
 * One team-bound item for a person who already passed the space guard: they see it if it has no team, if
 * they manage the space, or if they are in the team. One query at most.
 */
export async function seesTeam(userId: string, teamId: string | null, manager: boolean): Promise<boolean> {
  if (!teamId || manager) return true;
  const row = await db.teamMember.findUnique({ where: { teamId_userId: { teamId, userId } }, select: { id: true } });
  return !!row;
}

/**
 * Inside ONE space the caller already passed the guard for: the projects they see there. A manager sees all
 * (`{}`); anybody else the space's own projects (no team) and their teams'. Use it as a `project` filter.
 */
export async function teamFilterInSpace(userId: string, workspaceId: string, manager: boolean): Promise<Prisma.ProjectWhereInput> {
  if (manager) return {};
  const mine = await db.teamMember.findMany({ where: { userId, team: { workspaceId } }, select: { teamId: true } });
  return { OR: [{ teamId: null }, ...(mine.length ? [{ teamId: { in: mine.map((m) => m.teamId) } }] : [])] };
}

/**
 * Does this person see this project (for a service that has only the person's id: creating a task, converting
 * an idea)? The space must be theirs (or their company's, for the OWNER), then the team. A few queries.
 */
export async function userSeesProject(userId: string, project: { workspaceId: string; teamId: string | null }): Promise<boolean> {
  const ws = await db.workspace.findUnique({ where: { id: project.workspaceId }, select: { organizationId: true } });
  if (!ws) return false;
  const [om, row] = await Promise.all([
    db.organizationMember.findUnique({ where: { organizationId_userId: { organizationId: ws.organizationId, userId } }, select: { role: true, status: true } }),
    db.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: project.workspaceId, userId } }, select: { role: true } }),
  ]);
  if (!om || om.status !== "ACTIVE") return false;
  if (om.role !== "OWNER" && !row) return false;
  return seesTeam(userId, project.teamId, isSpaceManager(om.role, row?.role));
}
