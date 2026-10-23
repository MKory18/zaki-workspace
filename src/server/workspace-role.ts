/**
 * Who may do what inside ONE workspace (a "space"), from the two roles a person has: their
 * organization role and their row in the workspace (if any). A leaf module on purpose (no imports),
 * so the API guard (`requireWorkspace`) and the pages (List, Calendar, My Work, board) share one
 * rule and cannot drift apart.
 *
 * The rules that matter:
 *  - a space is visible only to the people IN it (they have a row) and to the OWNER, who sees every
 *    space of the company without a row; an ADMIN is not special here: no row, no space;
 *  - an org GUEST is an external partner, and is a guest in EVERY space, whatever their row says
 *    (older data stored them as a workspace MEMBER).
 */

export type WorkspaceRoleName = "ADMIN" | "MEMBER" | "GUEST";

/** The role a person has inside a workspace they have a row in (`wsRole`). */
export function workspaceRoleOf(orgRole: string | null | undefined, wsRole: WorkspaceRoleName): WorkspaceRoleName {
  return orgRole === "GUEST" ? "GUEST" : wsRole;
}

/** Organization roles that work inside spaces they are put in (the OWNER and GUEST are handled apart). */
const STAFF_ROLES: ReadonlySet<string> = new Set(["ADMIN", "LEAD", "MEMBER"]);

/**
 * Can this person create or change things in the workspace? It gives the same answer as
 * `requireWorkspace(id, ["ADMIN", "MEMBER"])`, which every write route uses (`wsRole` is the
 * person's row in that workspace, or null/undefined when they have none):
 *  - an org GUEST: never;
 *  - the org OWNER: always, with or without a row;
 *  - everybody else must be IN the space, and then:
 *      an org ADMIN: always (an ADMIN who is in a space outranks a lower row of their own);
 *      a LEAD or a MEMBER: unless their row says GUEST;
 *  - no organization role (not a member at all), or a role this code does not know: never.
 */
export function canWriteInWorkspace(orgRole: string | null | undefined, wsRole: string | null | undefined): boolean {
  if (orgRole === "GUEST") return false;
  if (orgRole === "OWNER") return true;
  if (!orgRole || !STAFF_ROLES.has(orgRole)) return false;
  if (!wsRole) return false;
  if (orgRole === "ADMIN") return true;
  return wsRole !== "GUEST";
}
