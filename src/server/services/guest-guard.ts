import { ForbiddenError } from "@/server/auth";

/**
 * Org GUESTs are external partners (for example the factory): they see only what
 * is shared with them, never write business data, and never see prices or the
 * staff directory. These helpers are the single place that says so.
 *
 * They take anything with an `orgRole` (an OrgAccessContext, or the context
 * `requireWorkspace` returns), so a route or a service can call them as the
 * first line of the handler.
 */

interface HasOrgRole {
  orgRole: string;
}

export function isGuest(ctx: HasOrgRole): boolean {
  return ctx.orgRole === "GUEST";
}

/** Writes (create, edit, delete, comment, change status) are never open to guests. */
export function assertCanWrite(ctx: HasOrgRole): void {
  if (isGuest(ctx)) throw new ForbiddenError("guest.readonly");
}

/** Areas that are not shared with guests at all, not even for reading (CRM, staff directory). */
export function assertNotGuest(ctx: HasOrgRole, messageKey = "guest.no_access"): void {
  if (isGuest(ctx)) throw new ForbiddenError(messageKey);
}
