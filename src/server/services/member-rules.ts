import type { MemberStatus, OrgRole } from "@prisma/client";
import { CAPABILITIES, RANK_DEFAULTS, grantProblem, type GrantProblem } from "@/server/policy/capabilities";
import { CREATABLE_ROLES, outranks } from "@/server/policy/rank";

/**
 * The rank rules of account management, in ONE place, as pure functions with no database and no
 * server-only import — so the members screen can offer exactly what the server allows by importing
 * this file. `org-members.ts` re-exports everything here; tests/org-members-logic.test.ts proves it
 * as a matrix. The rules answer for a caller who holds the capability `users.manage` (the routes
 * refuse everybody else before asking):
 *
 *  - administration is STRICTLY BELOW one's own rank: a peer is never "below" (resetting a peer's
 *    password would be signing in as them). The OWNER administers everybody but the OWNER; an
 *    ADMIN: LEAD/MEMBER/GUEST; a LEAD: MEMBER/GUEST; a MEMBER: GUEST; a GUEST: nobody;
 *  - the same for the roles one may give (creating an account, changing a role): only roles
 *    strictly below one's own — so only the OWNER creates ADMINs, and nobody creates an OWNER;
 *  - nobody administers themselves (checked by id in accounts.ts);
 *  - nobody hands out more than they hold: a capability is granted only by someone who holds it,
 *    and the rank defaults a non-owner does not hold are switched off (`unheldRankDefaults`).
 */

/** Roles an account can be created with or changed to (never OWNER). */
export const ASSIGNABLE_ROLES: OrgRole[] = [...CREATABLE_ROLES];

/** The roles this caller may give, when creating an account and when changing a role: those strictly below their own. */
export function grantableRoles(actorRole: OrgRole): OrgRole[] {
  return CREATABLE_ROLES.filter((role) => outranks(actorRole, role));
}

/** May this caller edit, suspend, offboard, reset or sign out a person of `targetRole`? Only somebody they outrank. */
export function canAdministrateTarget(actorRole: OrgRole, targetRole: OrgRole): boolean {
  return outranks(actorRole, targetRole);
}

export function canChangeRole(actorRole: OrgRole, targetRole: OrgRole, newRole: OrgRole): boolean {
  return canAdministrateTarget(actorRole, targetRole) && grantableRoles(actorRole).includes(newRole);
}

/** Offboarding (the old "remove") follows the same rule as every other administration. */
export function canRemoveMember(actorRole: OrgRole, targetRole: OrgRole): boolean {
  return canAdministrateTarget(actorRole, targetRole);
}

// ---------- account status ----------

export type StatusAction = "suspend" | "reactivate" | "offboard";

/** From which statuses each action may start. Anything else is a 409 `accounts.bad_transition`. */
export const STATUS_TRANSITIONS: Record<StatusAction, readonly MemberStatus[]> = {
  suspend: ["ACTIVE"],
  reactivate: ["SUSPENDED", "OFFBOARDED"],
  offboard: ["ACTIVE", "SUSPENDED"],
};

export function canTransitionStatus(action: StatusAction, from: MemberStatus): boolean {
  return STATUS_TRANSITIONS[action].includes(from);
}

// ---------- capabilities ----------

const GRANT_PROBLEM_KEY: Record<GrantProblem, string> = {
  unknown_capability: "accounts.cap_unknown",
  owner_only: "accounts.cap_owner_only",
  not_for_guests: "accounts.cap_not_for_guests",
  owner_has_all: "accounts.cap_owner_has_all",
};

/** The caller as far as capabilities go (an `Actor` fits). */
export interface CapabilityHolder {
  role: OrgRole;
  caps: ReadonlySet<string>;
}

/**
 * Why this caller may not switch `capability` on (or off) for a person of `targetRole`, as an
 * error key — null when they may. It must be grantable to that role at all (never to a guest,
 * never `archive.view`) and the caller must hold it themselves (the OWNER holds everything).
 */
export function capabilityChangeProblem(actor: CapabilityHolder, targetRole: OrgRole, capability: string): string | null {
  const problem = grantProblem(targetRole, capability);
  if (problem) return GRANT_PROBLEM_KEY[problem];
  if (!actor.caps.has(capability)) return "accounts.cap_not_held";
  return null;
}

/**
 * The defaults of `role` that this caller does not hold themselves: switched off (stored as revoked)
 * on an account a non-owner creates or re-ranks, so nobody produces an account holding more than
 * they hold. Capabilities in `keep` (explicit extras the person already has, given by somebody who
 * held them) stay as they are. The OWNER holds everything, so for him this is always empty.
 */
export function unheldRankDefaults(actor: CapabilityHolder, role: OrgRole, keep: readonly string[] = []): string[] {
  return RANK_DEFAULTS[role].filter((cap) => !actor.caps.has(cap) && !keep.includes(cap));
}

const CATALOGUE_ORDER = new Map<string, number>(CAPABILITIES.map((c, i) => [c, i]));

/** Without duplicates, in the order of the capability catalogue (unknown names last). */
export function inCatalogueOrder(list: Iterable<string>): string[] {
  return [...new Set(list)].sort((a, b) => (CATALOGUE_ORDER.get(a) ?? 1e3) - (CATALOGUE_ORDER.get(b) ?? 1e3));
}

/**
 * The list a person ends up with when a request replaces `stored` with `requested` (undefined =
 * the request does not touch this list), and what is wrong with the request. Only what CHANGES
 * is the caller's doing: an addition must pass `capabilityChangeProblem`, and a removal must be
 * held by the caller (you take away only what you could give, so an owner's grant survives an
 * admin's edit). Whatever the role can no longer hold is dropped: a guest ends with nothing.
 */
export function replaceCapabilityList(
  actor: CapabilityHolder,
  role: OrgRole,
  stored: readonly string[],
  requested: readonly string[] | undefined,
): { next: string[]; problem: string | null } {
  if (requested !== undefined) {
    const before = new Set(stored);
    const after = new Set(requested);
    for (const cap of after) {
      if (before.has(cap)) continue;
      const problem = capabilityChangeProblem(actor, role, cap);
      if (problem) return { next: [], problem };
    }
    for (const cap of before) {
      if (after.has(cap) || grantProblem(role, cap) !== null) continue;
      if (!actor.caps.has(cap)) return { next: [], problem: "accounts.cap_not_held" };
    }
  }
  const next = inCatalogueOrder((requested ?? stored).filter((cap) => grantProblem(role, cap) === null));
  return { next, problem: null };
}

// ---------- managers ----------

/**
 * Would making `newManagerId` the manager of `subjectId` close a loop (somebody above
 * themselves)? `managerOf` maps every member of the organization to their current manager.
 * Old data with a loop elsewhere cannot hang the walk.
 */
export function wouldCreateManagerCycle(
  managerOf: ReadonlyMap<string, string | null>,
  subjectId: string,
  newManagerId: string,
): boolean {
  const seen = new Set<string>();
  let cursor: string | null = newManagerId;
  while (cursor !== null && !seen.has(cursor)) {
    if (cursor === subjectId) return true;
    seen.add(cursor);
    cursor = managerOf.get(cursor) ?? null;
  }
  return false;
}
