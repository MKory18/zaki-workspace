import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { ForbiddenError, NotFoundError, hashPassword, verifyPassword } from "@/server/auth";
import { avatarHue } from "@/lib/format";

export interface ProfilePatch {
  name?: string;
  jobTitle?: string;
  bio?: string | null;
  locale?: string;
}

/** Self-service profile update. Locale/theme are constrained at the API layer. */
export async function updateProfile(userId: string, patch: ProfilePatch): Promise<void> {
  const data: Prisma.UserUpdateInput = {};
  if (patch.name !== undefined) data.name = patch.name;
  if (patch.jobTitle !== undefined) data.jobTitle = patch.jobTitle;
  if (patch.bio !== undefined) data.bio = patch.bio;
  if (patch.locale !== undefined) data.locale = patch.locale;
  await db.user.update({ where: { id: userId }, data });
}

/** Password change requires the current password to match (verified server-side). */
export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true },
  });
  if (!user) throw new NotFoundError("user.not_found");
  const ok = await verifyPassword(currentPassword, user.passwordHash);
  if (!ok) throw new ForbiddenError("password.wrong_current");
  await db.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(newPassword) },
  });
}

export interface PublicProfile {
  id: string;
  name: string;
  jobTitle: string | null;
  bio: string | null;
  createdAt: Date;
  organizationId: string;
  organizationName: string;
  organizationRole: string;
  stats: {
    ideasCreated: number;
    ideasVotesReceived: number;
    openTasksAssigned: number;
    tasksCompleted: number;
  };
}

/**
 * What a viewer may see of another person.
 *  - "full": the whole profile (everyone who is not an org GUEST).
 *  - "limited": an org GUEST sees `{ id, name }` and nothing else (no job title, bio,
 *    email, role or stats), and only for people who share a workspace with them
 *    (and themselves). Anybody else is "not found".
 */
export type ProfileView =
  | { kind: "full"; profile: PublicProfile }
  | { kind: "limited"; profile: { id: string; name: string } };

/**
 * Profile of another member, visible only through a shared organization.
 * Cross-org ids → not found (no existence oracle). A viewer who is only a GUEST
 * in every organization they share with the target gets the "limited" view.
 */
export async function getProfileForViewer(viewerId: string, targetId: string): Promise<ProfileView> {
  const viewMemberships = await db.organizationMember.findMany({
    where: { userId: viewerId },
    select: { organizationId: true, role: true },
  });
  const visibleOrgIds = viewMemberships.map((m) => m.organizationId);
  if (visibleOrgIds.length === 0) throw new ForbiddenError("not_org_member");
  // organizations where the viewer is a real member (guests see no profiles there)
  const staffOrgIds = viewMemberships.filter((m) => m.role !== "GUEST").map((m) => m.organizationId);

  const target = await db.user.findUnique({
    where: { id: targetId },
    select: {
      id: true,
      name: true,
      jobTitle: true,
      bio: true,
      createdAt: true,
      memberships: {
        where: { organizationId: { in: visibleOrgIds } },
        select: { role: true, organization: { select: { id: true, name: true } } },
      },
    },
  });
  if (!target) throw new NotFoundError("user.not_found");
  if (target.memberships.length === 0) throw new NotFoundError("user.not_found"); // no shared org

  const membership = target.memberships.find((m) => staffOrgIds.includes(m.organization.id));
  if (!membership) {
    // the viewer is only a guest in every organization they share with the target
    if (target.id !== viewerId) {
      const sharedWorkspace = await db.workspaceMember.findFirst({
        where: {
          userId: target.id,
          workspace: {
            organizationId: { in: target.memberships.map((m) => m.organization.id) },
            members: { some: { userId: viewerId } },
          },
        },
        select: { id: true },
      });
      if (!sharedWorkspace) throw new NotFoundError("user.not_found");
    }
    return { kind: "limited", profile: { id: target.id, name: target.name } };
  }

  const stats = await Promise.all([
    db.idea.count({ where: { creatorId: targetId, orgId: { in: staffOrgIds } } }),
    db.ideaVote.count({
      where: { idea: { creatorId: targetId, orgId: { in: staffOrgIds } } },
    }),
    db.task.count({ where: { assigneeId: targetId, orgId: { in: staffOrgIds }, completedAt: null, archived: false } }),
    db.task.count({ where: { assigneeId: targetId, orgId: { in: staffOrgIds }, completedAt: { not: null }, archived: false } }),
  ]);
  const votesReceived = stats[1];

  return {
    kind: "full",
    profile: {
      id: target.id,
      name: target.name,
      jobTitle: target.jobTitle,
      bio: target.bio,
      createdAt: target.createdAt,
      organizationId: membership.organization.id,
      organizationName: membership.organization.name,
      organizationRole: membership.role,
      stats: {
        ideasCreated: stats[0],
        ideasVotesReceived: votesReceived,
        openTasksAssigned: stats[2],
        tasksCompleted: stats[3],
      },
    },
  };
}

/**
 * The full profile page of a member (the /u/[id] page). Guests have no profile
 * pages: they only ever get the names-only view of getProfileForViewer, so for
 * them this is "not found".
 */
export async function getPublicProfile(viewerId: string, targetId: string): Promise<PublicProfile> {
  const view = await getProfileForViewer(viewerId, targetId);
  if (view.kind === "limited") throw new NotFoundError("user.not_found");
  return view.profile;
}

/**
 * The people an org GUEST may see in `orgId`: those who share a workspace with them
 * (and the guest). Names only; every other field is blanked.
 */
async function guestDirectoryMembers(viewerId: string, orgId: string) {
  const mine = await db.workspaceMember.findMany({
    where: { userId: viewerId, workspace: { organizationId: orgId } },
    select: { workspaceId: true },
  });
  const mates = mine.length
    ? await db.workspaceMember.findMany({
        where: {
          workspaceId: { in: mine.map((w) => w.workspaceId) },
          // somebody who left the org may still have a workspace row; they are not listed
          user: { memberships: { some: { organizationId: orgId } } },
        },
        select: { user: { select: { id: true, name: true } } },
      })
    : [];
  const people = new Map<string, string>();
  for (const row of mates) people.set(row.user.id, row.user.name);
  if (!people.has(viewerId)) {
    const me = await db.user.findUnique({ where: { id: viewerId }, select: { id: true, name: true } });
    if (me) people.set(me.id, me.name);
  }
  return [...people.entries()]
    .map(([userId, name]) => ({ userId, name, jobTitle: null, role: "", email: null }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Member directory of the viewer's organizations. In an organization where the
 * viewer is a GUEST the list is names only and limited to the people they share a
 * workspace with (`restricted: true`; job title, role and email are blank).
 */
export async function memberDirectory(viewerId: string): Promise<
  {
    organizationId: string;
    organizationName: string;
    orgRole: string; // viewer's role in this org
    canManage: boolean;
    joinCode: string | null;
    restricted: boolean; // true for a guest viewer: names only
    members: {
      userId: string;
      name: string;
      jobTitle: string | null;
      role: string;
      email: string | null; // email exposed only to admins/owner
    }[];
  }[]
> {
  const memberships = await db.organizationMember.findMany({
    where: { userId: viewerId },
    select: { organizationId: true, organization: { select: { id: true, name: true, joinCode: true } }, role: true },
    orderBy: { createdAt: "asc" },
  });

  const result = await Promise.all(
    memberships.map(async (m) => {
      if (m.role === "GUEST") {
        return {
          organizationId: m.organizationId,
          organizationName: m.organization.name,
          orgRole: m.role,
          canManage: false,
          joinCode: null,
          restricted: true,
          members: await guestDirectoryMembers(viewerId, m.organizationId),
        };
      }
      const canManage = m.role === "OWNER" || m.role === "ADMIN";
      const rows = await db.organizationMember.findMany({
        where: { organizationId: m.organizationId },
        select: {
          role: true,
          user: { select: { id: true, name: true, jobTitle: true, email: true } },
        },
        orderBy: { createdAt: "asc" },
      });
      const roleOrder: Record<string, number> = { OWNER: 0, ADMIN: 1, MEMBER: 2, GUEST: 3 };
      rows.sort((a, b) => (roleOrder[a.role] ?? 9) - (roleOrder[b.role] ?? 9));
      return {
        organizationId: m.organizationId,
        organizationName: m.organization.name,
        orgRole: m.role,
        canManage,
        joinCode: canManage ? m.organization.joinCode : null,
        restricted: false,
        members: rows.map((r) => ({
          userId: r.user.id,
          name: r.user.name,
          jobTitle: r.user.jobTitle,
          role: r.role,
          email: canManage ? r.user.email : null,
        })),
      };
    }),
  );
  return result;
}
