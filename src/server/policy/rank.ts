import type { OrgRole } from "@prisma/client";

/**
 * Ranks, highest first. Never rely on the order of the database enum for this: the order here is
 * the only one that means "who outranks whom".
 */
export const RANK: Record<OrgRole, number> = {
  OWNER: 50,
  ADMIN: 40,
  LEAD: 30,
  MEMBER: 20,
  GUEST: 10,
};

export function rankOf(role: OrgRole): number {
  return RANK[role];
}

/** `a` is strictly above `b`. */
export function outranks(a: OrgRole, b: OrgRole): boolean {
  return RANK[a] > RANK[b];
}

/** `a` is `b` or above. */
export function atLeast(a: OrgRole, b: OrgRole): boolean {
  return RANK[a] >= RANK[b];
}

/** Roles an account can be CREATED with. There is exactly one OWNER, made when the company is set up. */
export const CREATABLE_ROLES: OrgRole[] = ["ADMIN", "LEAD", "MEMBER", "GUEST"];
