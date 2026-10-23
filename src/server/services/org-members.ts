import type { MemberStatus, OrgRole, Prisma, TicketStatus, WorkspaceRole } from "@prisma/client";
import { db } from "@/server/db";
import { effectiveCapabilities } from "@/server/policy/capabilities";
import { RANK } from "@/server/policy/rank";
import type { Actor } from "@/server/policy/actor";
import { accessibleWorkspaceIds } from "@/server/services/access";
import { inCatalogueOrder } from "@/server/services/member-rules";

/**
 * Organization members: the rank rules of account management and the roster.
 *
 * The rules are pure functions kept in member-rules.ts (no database, so the members screen can
 * import the very same rules) and re-exported here; tests/org-members-logic.test.ts proves them as
 * a matrix. The account lifecycle that applies them is accounts.ts.
 */
export {
  ASSIGNABLE_ROLES,
  STATUS_TRANSITIONS,
  canAdministrateTarget,
  canChangeRole,
  canRemoveMember,
  canTransitionStatus,
  capabilityChangeProblem,
  grantableRoles,
  inCatalogueOrder,
  replaceCapabilityList,
  unheldRankDefaults,
  wouldCreateManagerCycle,
  type CapabilityHolder,
  type StatusAction,
} from "@/server/services/member-rules";

// ---------- open work ----------

/**
 * What "open work" is — the work assigned to a person (`assigneeId`) that still needs doing. The
 * roster's `openWork` count and the offboarding transfer use these same definitions. (Task,
 * Ticket and Routine are the only models with an assignee; campaign and opportunity owners are
 * their creators and stay as they are.)
 */
export const OPEN_TICKET_STATUSES: TicketStatus[] = ["OPEN", "IN_PROGRESS"];

export function openTaskWhere(orgId: string): Prisma.TaskWhereInput {
  return { orgId, completedAt: null, archived: false };
}

export function openTicketWhere(orgId: string): Prisma.TicketWhereInput {
  return { orgId, status: { in: OPEN_TICKET_STATUSES } };
}

export function activeRoutineWhere(orgId: string): Prisma.RoutineWhereInput {
  return { orgId, active: true };
}

// ---------- the roster ----------

export interface RosterMember {
  id: string;
  name: string;
  username: string | null;
  email: string | null;
  jobTitle: string | null;
  role: OrgRole;
  status: MemberStatus;
  managerId: string | null;
  managerName: string | null;
  capabilities: string[];
  revokedCapabilities: string[];
  effectiveCapabilities: string[];
  lastLoginAt: Date | null;
  mustChangePassword: boolean;
  /** Open tasks + open tickets + active routines assigned to the person (offboarding needs a receiver when > 0). */
  openWork: number;
  /** The person's spaces in this organization — only those the caller may see themselves. */
  workspaces: { id: string; name: string; role: WorkspaceRole }[];
}

export interface Roster {
  members: RosterMember[];
  actorRole: OrgRole;
  /** The spaces the caller may put people into: every space for the OWNER, otherwise their own. */
  spaces: { id: string; name: string }[];
}

const STATUS_ORDER: Record<MemberStatus, number> = { ACTIVE: 0, SUSPENDED: 1, OFFBOARDED: 2 };

/**
 * Everybody in the caller's organization, every status: ACTIVE first, then SUSPENDED, then
 * OFFBOARDED; inside each, the highest rank first, then by name. Never a password hash or a
 * session version (fields are selected one by one).
 */
export async function listOrgMembers(actor: Pick<Actor, "userId" | "orgId" | "role" | "isOwner">): Promise<Roster> {
  const orgId = actor.orgId;
  const rows = await db.organizationMember.findMany({
    where: { organizationId: orgId },
    select: {
      role: true,
      status: true,
      capabilities: true,
      revokedCapabilities: true,
      managerId: true,
      manager: { select: { name: true } },
      user: {
        select: {
          id: true,
          name: true,
          username: true,
          email: true,
          jobTitle: true,
          lastLoginAt: true,
          mustChangePassword: true,
        },
      },
    },
  });
  const ids = rows.map((r) => r.user.id);

  const [tasks, tickets, routines, links, orgSpaces, mine] = await Promise.all([
    db.task.groupBy({ by: ["assigneeId"], where: { ...openTaskWhere(orgId), assigneeId: { in: ids } }, _count: { _all: true } }),
    db.ticket.groupBy({ by: ["assigneeId"], where: { ...openTicketWhere(orgId), assigneeId: { in: ids } }, _count: { _all: true } }),
    db.routine.groupBy({ by: ["assigneeId"], where: { ...activeRoutineWhere(orgId), assigneeId: { in: ids } }, _count: { _all: true } }),
    db.workspaceMember.findMany({
      where: { userId: { in: ids }, workspace: { organizationId: orgId } },
      select: { userId: true, role: true, workspace: { select: { id: true, name: true } } },
      orderBy: { workspace: { name: "asc" } },
    }),
    db.workspace.findMany({ where: { organizationId: orgId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    actor.isOwner ? Promise.resolve(null) : accessibleWorkspaceIds(actor.userId),
  ]);

  const openWork = new Map<string, number>();
  for (const group of [tasks, tickets, routines]) {
    for (const g of group) {
      if (g.assigneeId) openWork.set(g.assigneeId, (openWork.get(g.assigneeId) ?? 0) + g._count._all);
    }
  }
  const visible = mine === null ? null : new Set(mine);
  const spacesOf = new Map<string, RosterMember["workspaces"]>();
  for (const link of links) {
    if (visible && !visible.has(link.workspace.id)) continue;
    const list = spacesOf.get(link.userId) ?? [];
    list.push({ id: link.workspace.id, name: link.workspace.name, role: link.role });
    spacesOf.set(link.userId, list);
  }

  const members: RosterMember[] = rows.map((r) => ({
    id: r.user.id,
    name: r.user.name,
    username: r.user.username,
    email: r.user.email,
    jobTitle: r.user.jobTitle,
    role: r.role,
    status: r.status,
    managerId: r.managerId,
    managerName: r.manager?.name ?? null,
    capabilities: r.capabilities,
    revokedCapabilities: r.revokedCapabilities,
    effectiveCapabilities: inCatalogueOrder(effectiveCapabilities(r)),
    lastLoginAt: r.user.lastLoginAt,
    mustChangePassword: r.user.mustChangePassword,
    openWork: openWork.get(r.user.id) ?? 0,
    workspaces: spacesOf.get(r.user.id) ?? [],
  }));
  members.sort(
    (a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || RANK[b.role] - RANK[a.role] || a.name.localeCompare(b.name, "ar"),
  );

  return {
    members,
    actorRole: actor.role,
    spaces: visible ? orgSpaces.filter((s) => visible.has(s.id)) : orgSpaces,
  };
}
