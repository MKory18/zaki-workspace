import type { OrgRole } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { canManageOrg } from "@/server/services/orgs";

describe("orgRBAC.canManageOrg", () => {
  // A Record over the whole enum: a new rank cannot be added to the schema without deciding it here.
  const expected: Record<OrgRole, boolean> = { OWNER: true, ADMIN: true, LEAD: false, MEMBER: false, GUEST: false };

  it("OWNER and ADMIN can manage; LEAD, MEMBER and GUEST cannot", () => {
    for (const [role, allowed] of Object.entries(expected) as [OrgRole, boolean][]) {
      expect(canManageOrg(role), role).toBe(allowed);
    }
    expect(canManageOrg("OWNER")).toBe(true);
    expect(canManageOrg("ADMIN")).toBe(true);
    expect(canManageOrg("LEAD")).toBe(false);
    expect(canManageOrg("MEMBER")).toBe(false);
    expect(canManageOrg("GUEST")).toBe(false);
  });
});
