import { describe, expect, it } from "vitest";
import { canManageOrg } from "@/server/services/orgs";

describe("orgRBAC.canManageOrg", () => {
  it("OWNER and ADMIN can manage; MEMBER and GUEST cannot", () => {
    expect(canManageOrg("OWNER")).toBe(true);
    expect(canManageOrg("ADMIN")).toBe(true);
    expect(canManageOrg("MEMBER")).toBe(false);
    expect(canManageOrg("GUEST")).toBe(false);
  });
});

import type { OrgRole } from "@prisma/client";
