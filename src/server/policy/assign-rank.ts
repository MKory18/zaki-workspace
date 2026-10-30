import type { OrgRole } from "@prisma/client";
import { RANK } from "./rank";

/**
 * WHO MAY GIVE A TASK TO WHOM, BY RANK (the owner's decision, 2026-10-30). Pure: the database half (is the person in
 * the space, is the person active) is `src/server/services/task-assign.ts`, which calls this.
 *
 *   - to yourself, to somebody BELOW you, to somebody of the SAME rank: direct;
 *   - to somebody ABOVE you: a request that the higher person accepts or returns (never a plain assignment);
 *   - the OWNER gives to anybody directly (nobody is above him), and everybody else giving to him asks;
 *   - an external partner (GUEST) never asks: giving upward is refused outright.
 */
export type AssignKind = "direct" | "request" | "refused";

/** What happens when `actor` gives a task to `target` (a different person). */
export function assignKindByRank(actor: OrgRole, target: OrgRole): AssignKind {
  if (actor === "OWNER") return "direct";
  if (RANK[target] <= RANK[actor]) return "direct";
  return actor === "GUEST" ? "refused" : "request";
}

/** The picker marks «طلب» next to somebody a pick would only ask (never for the person themself). */
export function isRequestTo(actor: OrgRole, target: OrgRole): boolean {
  return assignKindByRank(actor, target) === "request";
}
