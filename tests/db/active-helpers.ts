import type { MemberStatus, OrgRole } from "@prisma/client";
import { db } from "./helpers";

/**
 * Fixtures for the "nobody who was suspended or removed still counts" batch and for the
 * "permission switches really switch things" batch (tests/db/active-*.test.ts).
 * Everything goes through `db.*` directly, so a fixture never depends on the services under test.
 */

export interface OrgCtx {
  orgId: string;
  orgRole: OrgRole;
  userId: string;
}

/** The context the routes hand to a service (`activeOrgCtx()`), built by hand. */
export const ctxOf = (orgId: string, userId: string, orgRole: OrgRole = "MEMBER"): OrgCtx => ({ orgId, orgRole, userId });

export function setStatus(orgId: string, userId: string, status: MemberStatus) {
  return db.organizationMember.update({
    where: { organizationId_userId: { organizationId: orgId, userId } },
    data: { status, statusChangedAt: new Date() },
  });
}

export const suspend = (orgId: string, userId: string) => setStatus(orgId, userId, "SUSPENDED");
export const offboard = (orgId: string, userId: string) => setStatus(orgId, userId, "OFFBOARDED");

/** The owner's per-person switches: extra capabilities on, or rank defaults taken away. */
export function setCapabilities(
  orgId: string,
  userId: string,
  patch: { capabilities?: string[]; revokedCapabilities?: string[] },
) {
  return db.organizationMember.update({
    where: { organizationId_userId: { organizationId: orgId, userId } },
    data: patch,
  });
}
