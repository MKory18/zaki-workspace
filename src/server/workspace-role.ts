/**
 * Who may do what inside ONE workspace, from the two roles a person has: their organization
 * role and their row in the workspace (if any). A leaf module on purpose (no imports), so the
 * API guard (`requireWorkspace`) and the pages (List, Calendar, My Work) share one rule and
 * cannot drift apart.
 *
 * The rule that matters: an org GUEST is an external partner, and is a guest in EVERY workspace,
 * whatever their workspace row says (older data stored them as a workspace MEMBER).
 */

export type WorkspaceRoleName = "ADMIN" | "MEMBER" | "GUEST";

/** The role a person has inside a workspace they have a row in (`wsRole`). */
export function workspaceRoleOf(orgRole: string | null | undefined, wsRole: WorkspaceRoleName): WorkspaceRoleName {
  return orgRole === "GUEST" ? "GUEST" : wsRole;
}

/**
 * Can this person create or change things in the workspace? It gives the same answer as
 * `requireWorkspace(id, ["ADMIN", "MEMBER"])`, which every write route uses:
 *  - an org GUEST: never;
 *  - an org OWNER/ADMIN: always (they outrank any workspace row);
 *  - anyone else: unless their workspace row says GUEST (no row = a plain member).
 */
export function canWriteInWorkspace(orgRole: string | null | undefined, wsRole: string | null | undefined): boolean {
  if (orgRole === "GUEST") return false;
  if (orgRole === "OWNER" || orgRole === "ADMIN") return true;
  return wsRole !== "GUEST";
}
