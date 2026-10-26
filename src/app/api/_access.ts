import type { OrgAccessContext } from "@/server/auth";
import { assertCan, requireActor } from "@/server/policy/actor";
import { assertNotGuest } from "@/server/services/guest-guard";

/**
 * Route guards for the areas that are a capability switch on top of the rank. Each returns the
 * caller's organization context (their oldest ACTIVE membership), like `activeOrgCtx()`.
 *
 * An external partner (guest) is always answered first, with the message key the area has always
 * used for them, whatever the switches say; for everybody else the capability decides and the
 * answer is 403 `insufficient_role`.
 */

/**
 * The CRM (customers and opportunities) is staff-only, on the customers row of the person's grid: `crm.view` opens it
 * for reading, `crm.edit` for adding and changing, `crm.delete` for deleting.
 */
export async function crmContext(mode: "view" | "edit" | "delete"): Promise<OrgAccessContext> {
  const actor = await requireActor();
  assertNotGuest({ orgRole: actor.role });
  assertCan(actor, mode === "delete" ? "crm.delete" : mode === "edit" ? "crm.edit" : "crm.view");
  return { orgId: actor.orgId, orgRole: actor.role, userId: actor.userId };
}

/**
 * The staff directory (who works here, their titles): `directory.view`. Guests are refused with
 * `guestMessage` (`guest.no_access` unless the area has its own key, e.g. `chat.guest_forbidden`).
 */
export async function directoryContext(guestMessage = "guest.no_access"): Promise<OrgAccessContext> {
  const actor = await requireActor();
  assertNotGuest({ orgRole: actor.role }, guestMessage);
  assertCan(actor, "directory.view");
  return { orgId: actor.orgId, orgRole: actor.role, userId: actor.userId };
}
