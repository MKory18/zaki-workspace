import { z } from "zod";
import type { OrgRole } from "@prisma/client";
import { db } from "@/server/db";
import { ForbiddenError, NotFoundError, audit, hashPassword, type OrgAccessContext } from "@/server/auth";
import { pushNotification } from "@/server/notify";

/** Org roles an org-manager may grant when adding/changing employees. */
export const ASSIGNABLE_ROLES: OrgRole[] = ["ADMIN", "MEMBER", "GUEST"];

/** Which roles each manager level can grant. OWNER can grant all three; ADMIN only MEMBER/GUEST. */
export function grantableRoles(actorRole: OrgRole): OrgRole[] {
  return actorRole === "OWNER" ? [...ASSIGNABLE_ROLES] : actorRole === "ADMIN" ? ["MEMBER", "GUEST"] : [];
}

/** Race roles: admins may only touch plain members/guests; the OWNER person row is untouchable. */
export function canAdministrateTarget(actorRole: OrgRole, targetRole: OrgRole): boolean {
  if (targetRole === "OWNER") return false;
  if (actorRole === "OWNER") return true;
  if (actorRole === "ADMIN") return targetRole === "MEMBER" || targetRole === "GUEST";
  return false;
}

export function canChangeRole(actorRole: OrgRole, targetRole: OrgRole, newRole: OrgRole): boolean {
  if (!canAdministrateTarget(actorRole, targetRole)) return false;
  if (!grantableRoles(actorRole).includes(newRole)) return false;
  return true;
}

export function canRemoveMember(actorRole: OrgRole, targetRole: OrgRole): boolean {
  return canAdministrateTarget(actorRole, targetRole);
}

const NEW_NAME = z.string().trim().min(2, "name.too_short").max(80, "name.too_long");
const NEW_EMAIL = z.string().trim().toLowerCase().email("email.invalid");
const NEW_PASSWORD = z
  .string()
  .min(8, "password.min8")
  .regex(/[A-Za-z]/, "password.letter")
  .regex(/[0-9]/, "password.digit");

export const addMemberSchema = z.object({
  name: NEW_NAME,
  email: NEW_EMAIL,
  password: NEW_PASSWORD,
  role: z.enum(["ADMIN", "MEMBER", "GUEST"]).default("MEMBER"),
});

export const memberUpdateSchema = z
  .object({
    role: z.enum(["ADMIN", "MEMBER", "GUEST"]).optional(),
    password: NEW_PASSWORD.optional(),
  })
  .refine((v) => v.role !== undefined || v.password !== undefined, { message: "orgm.no_change" });

/** Members roster for the settings manager ( OWNER/ADMIN callers). */
export async function listOrgMembers(orgId: string) {
  const rows = await db.organizationMember.findMany({
    where: { organizationId: orgId },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    select: {
      role: true,
      createdAt: true,
      user: { select: { id: true, name: true, email: true, jobTitle: true } },
    },
  });
  return rows.map((m) => ({ ...m.user, role: m.role as OrgRole, joinedAt: m.createdAt }));
}

/** Admin-created employee: account + membership + welcome notification. */
export async function addOrgMember(
  ctx: OrgAccessContext,
  input: z.infer<typeof addMemberSchema>,
): Promise<{ userId: string }> {
  if (!grantableRoles(ctx.orgRole).includes(input.role)) throw new ForbiddenError("orgm.role_denied");
  const existing = await db.user.findUnique({ where: { email: input.email }, select: { id: true } });
  if (existing) {
    const member = await db.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: ctx.orgId, userId: existing.id } },
      select: { id: true },
    });
    throw new ForbiddenError(member ? "orgm.already_member" : "email.taken");
  }
  const user = await db.user.create({
    data: {
      email: input.email,
      name: input.name,
      passwordHash: await hashPassword(input.password),
      memberships: { create: { organizationId: ctx.orgId, role: input.role } },
    },
    select: { id: true },
  });
  await audit("org.member_added", {
    actorId: ctx.userId,
    orgId: ctx.orgId,
    target: user.id,
    meta: { role: input.role },
  });
  const org = await db.organization.findUnique({
    where: { id: ctx.orgId },
    select: { name: true },
  });
  await pushNotification({
    userId: user.id,
    type: "welcome",
    title: "Zakai.io",
    body: org?.name ?? null,
    linkUrl: "/",
  });
  return { userId: user.id };
}

async function assertTarget(organizationId: string, userId: string) {
  const row = await db.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    select: { role: true },
  });
  if (!row) throw new NotFoundError("orgm.not_member");
  return row.role as OrgRole;
}

/** Role change and/or admin password reset on one employee. */
export async function updateOrgMember(
  ctx: OrgAccessContext,
  userId: string,
  input: z.infer<typeof memberUpdateSchema>,
): Promise<void> {
  const targetRole = await assertTarget(ctx.orgId, userId);
  // Whoever the caller may not administrate cannot be changed in ANY way: the
  // password reset is as much a takeover as a role change (an ADMIN must not be
  // able to log in as the OWNER). Own password has its own endpoint (/api/me/password).
  if (!canAdministrateTarget(ctx.orgRole, targetRole)) throw new ForbiddenError("orgm.role_denied");
  if (input.role) {
    if (!canChangeRole(ctx.orgRole, targetRole, input.role)) throw new ForbiddenError("orgm.role_denied");
    if (targetRole !== input.role) {
      await db.organizationMember.update({
        where: { organizationId_userId: { organizationId: ctx.orgId, userId } },
        data: { role: input.role },
      });
      await audit("org.member_role_changed", {
        actorId: ctx.userId,
        orgId: ctx.orgId,
        target: userId,
        meta: { from: targetRole, to: input.role },
      });
      await pushNotification({
        userId,
        type: "org_role_changed",
        title: "Zakai.io",
        body: null,
        linkUrl: "/",
      });
    }
  }
  if (input.password) {
    await db.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(input.password) },
      select: { id: true },
    });
    await audit("org.member_password_reset", { actorId: ctx.userId, orgId: ctx.orgId, target: userId });
  }
}

/** remove membership — separately: user account survives (may belong to other flows). */
export async function removeOrgMember(ctx: OrgAccessContext, userId: string): Promise<void> {
  const targetRole = await assertTarget(ctx.orgId, userId);
  if (!canRemoveMember(ctx.orgRole, targetRole)) throw new ForbiddenError("orgm.role_denied");
  await db.organizationMember.delete({
    where: { organizationId_userId: { organizationId: ctx.orgId, userId } },
  });
  await audit("org.member_removed", { actorId: ctx.userId, orgId: ctx.orgId, target: userId });
}
