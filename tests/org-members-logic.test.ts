import { describe, expect, it } from "vitest";
import {
  ASSIGNABLE_ROLES,
  canAdministrateTarget,
  canChangeRole,
  canRemoveMember,
  grantableRoles,
} from "@/server/services/org-members";

describe("org member role policy", () => {
  it("owner can grant every role; admin only member/guest", () => {
    expect(grantableRoles("OWNER")).toEqual([...ASSIGNABLE_ROLES]);
    expect(grantableRoles("ADMIN")).toEqual(["MEMBER", "GUEST"]);
    expect(grantableRoles("MEMBER")).toEqual([]);
  });

  it("the OWNER person row is untouchable by anyone", () => {
    expect(canAdministrateTarget("OWNER", "OWNER")).toBe(false);
    expect(canAdministrateTarget("ADMIN", "OWNER")).toBe(false);
    expect(canRemoveMember("OWNER", "OWNER")).toBe(false);
  });

  it("admins manage plain members/guests only", () => {
    expect(canAdministrateTarget("ADMIN", "MEMBER")).toBe(true);
    expect(canAdministrateTarget("ADMIN", "GUEST")).toBe(true);
    expect(canAdministrateTarget("ADMIN", "ADMIN")).toBe(false);
    expect(canRemoveMember("OWNER", "ADMIN")).toBe(true);
  });

  it("role change = target reachable + role grantable", () => {
    expect(canChangeRole("OWNER", "MEMBER", "ADMIN")).toBe(true);
    expect(canChangeRole("ADMIN", "MEMBER", "ADMIN")).toBe(false);
    expect(canChangeRole("MEMBER", "MEMBER", "MEMBER")).toBe(false);
  });
});
