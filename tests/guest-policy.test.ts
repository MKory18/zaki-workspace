import { describe, expect, it } from "vitest";
import { ForbiddenError } from "@/server/auth";
import { assertCanWrite, assertNotGuest, isGuest } from "@/server/services/guest-guard";
import { canEditTicket } from "@/server/services/tickets";

describe("guest guard", () => {
  // every rank except the external partner (the LEAD rank is new in Phase 1)
  const STAFF = ["OWNER", "ADMIN", "LEAD", "MEMBER"];

  it("only the GUEST role is a guest", () => {
    expect(isGuest({ orgRole: "GUEST" })).toBe(true);
    for (const role of STAFF) expect(isGuest({ orgRole: role }), role).toBe(false);
  });

  it("assertCanWrite refuses guests with the read-only message and lets everyone else through", () => {
    expect(() => assertCanWrite({ orgRole: "GUEST" })).toThrowError(ForbiddenError);
    expect(() => assertCanWrite({ orgRole: "GUEST" })).toThrowError("guest.readonly");
    for (const role of STAFF) expect(() => assertCanWrite({ orgRole: role }), role).not.toThrow();
  });

  it("assertNotGuest refuses guests, with a custom message when given", () => {
    expect(() => assertNotGuest({ orgRole: "GUEST" })).toThrowError("guest.no_access");
    expect(() => assertNotGuest({ orgRole: "GUEST" }, "chat.guest_forbidden")).toThrowError("chat.guest_forbidden");
    for (const role of STAFF) expect(() => assertNotGuest({ orgRole: role }), role).not.toThrow();
  });
});

describe("canEditTicket", () => {
  const nobody = { isAdmin: false, isDeptMember: false, isDeptLead: false, isCreator: false, isAssignee: false };
  const statuses = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"] as const;

  it("an unrelated person can never edit, whatever the status", () => {
    for (const status of statuses) expect(canEditTicket({ ...nobody, status })).toBe(false);
  });

  it("org admins, department members, the department lead and the assignee can edit at any status", () => {
    for (const status of statuses) {
      expect(canEditTicket({ ...nobody, isAdmin: true, status })).toBe(true);
      expect(canEditTicket({ ...nobody, isDeptMember: true, status })).toBe(true);
      expect(canEditTicket({ ...nobody, isDeptLead: true, status })).toBe(true);
      expect(canEditTicket({ ...nobody, isAssignee: true, status })).toBe(true);
    }
  });

  it("a creator who is otherwise unrelated can edit only while the ticket is OPEN (the old limit)", () => {
    expect(canEditTicket({ ...nobody, isCreator: true, status: "OPEN" })).toBe(true);
    for (const status of ["IN_PROGRESS", "RESOLVED", "CLOSED"] as const) {
      expect(canEditTicket({ ...nobody, isCreator: true, status })).toBe(false);
    }
  });
});
