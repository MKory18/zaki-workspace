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
 * Profile of another member, visible only through a shared organization.
 * Cross-org ids → not found (no existence oracle).
 */
export async function getPublicProfile(viewerId: string, targetId: string): Promise<PublicProfile> {
  const viewMemberships = await db.organizationMember.findMany({
    where: { userId: viewerId },
    select: { organizationId: true },
  });
  const visibleOrgIds = viewMemberships.map((m) => m.organizationId);
  if (visibleOrgIds.length === 0) throw new ForbiddenError("not_org_member");

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
  const membership = target.memberships[0];
  if (!membership) throw new NotFoundError("user.not_found"); // no shared org

  const stats = await Promise.all([
    db.idea.count({ where: { creatorId: targetId, orgId: { in: visibleOrgIds } } }),
    db.ideaVote.count({
      where: { idea: { creatorId: targetId, orgId: { in: visibleOrgIds } } },
    }),
    db.task.count({ where: { assigneeId: targetId, orgId: { in: visibleOrgIds }, completedAt: null, archived: false } }),
    db.task.count({ where: { assigneeId: targetId, orgId: { in: visibleOrgIds }, completedAt: { not: null }, archived: false } }),
  ]);
  const votesReceived = stats[1];

  return {
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
  };
}

/** Member directory of the viewer's organizations. */
export async function memberDirectory(viewerId: string): Promise<
  {
    organizationId: string;
    organizationName: string;
    orgRole: string; // viewer's role in this org
    canManage: boolean;
    joinCode: string | null;
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
