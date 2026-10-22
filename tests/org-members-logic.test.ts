import { describe, expect, it } from "vitest";
import type { MemberStatus, OrgRole } from "@prisma/client";
import { CAPABILITIES, effectiveCapabilities } from "@/server/policy/capabilities";
import { CREATABLE_ROLES } from "@/server/policy/rank";
import {
  ASSIGNABLE_ROLES,
  canAdministrateTarget,
  canChangeRole,
  canRemoveMember,
  canTransitionStatus,
  capabilityChangeProblem,
  grantableRoles,
  replaceCapabilityList,
  unheldRankDefaults,
  wouldCreateManagerCycle,
} from "@/server/services/org-members";

/**
 * The rank rules of account management, as a matrix. They answer for a caller who holds
 * `users.manage` (the routes refuse everybody else before asking): the OWNER and ADMINs hold it
 * by default, a LEAD or MEMBER only when the owner switched it on for them.
 */
const ROLES: OrgRole[] = ["OWNER", "ADMIN", "LEAD", "MEMBER", "GUEST"];

describe("org member rank policy: who may administer whom", () => {
  // rows: the caller; columns: the person acted on (OWNER, ADMIN, LEAD, MEMBER, GUEST)
  // strictly below one's own rank: a peer is never "below" (review B, M1)
  const ADMINISTER: Record<OrgRole, boolean[]> = {
    OWNER: [false, true, true, true, true],
    ADMIN: [false, false, true, true, true],
    LEAD: [false, false, false, true, true],
    MEMBER: [false, false, false, false, true],
    GUEST: [false, false, false, false, false],
  };

  for (const actor of ROLES) {
    it(`${actor} administers exactly ${ROLES.filter((_, i) => ADMINISTER[actor][i]).join(", ") || "nobody"}`, () => {
      expect(ROLES.map((target) => canAdministrateTarget(actor, target))).toEqual(ADMINISTER[actor]);
      // removing (offboarding) follows the same rule
      expect(ROLES.map((target) => canRemoveMember(actor, target))).toEqual(ADMINISTER[actor]);
    });
  }

  it("the OWNER person row is untouchable by anyone, the OWNER included", () => {
    for (const actor of ROLES) expect(canAdministrateTarget(actor, "OWNER")).toBe(false);
    expect(canRemoveMember("OWNER", "OWNER")).toBe(false);
  });

  it("only the OWNER administers ADMINs; an ADMIN never touches another ADMIN", () => {
    expect(canAdministrateTarget("OWNER", "ADMIN")).toBe(true);
    expect(canAdministrateTarget("ADMIN", "ADMIN")).toBe(false);
    expect(canRemoveMember("OWNER", "ADMIN")).toBe(true);
    expect(canRemoveMember("ADMIN", "ADMIN")).toBe(false);
  });
});

describe("org member rank policy: which roles can be created", () => {
  it("roles come from CREATABLE_ROLES: nobody creates an OWNER", () => {
    expect(ASSIGNABLE_ROLES).toEqual(CREATABLE_ROLES);
    expect(ASSIGNABLE_ROLES).not.toContain("OWNER");
    for (const actor of ROLES) expect(grantableRoles(actor)).not.toContain("OWNER");
  });

  it("OWNER: every creatable role; everybody else: only roles strictly below their own; a guest: none", () => {
    expect(grantableRoles("OWNER")).toEqual([...ASSIGNABLE_ROLES]);
    expect(grantableRoles("OWNER")).toEqual(["ADMIN", "LEAD", "MEMBER", "GUEST"]);
    expect(grantableRoles("ADMIN")).toEqual(["LEAD", "MEMBER", "GUEST"]);
    expect(grantableRoles("LEAD")).toEqual(["MEMBER", "GUEST"]);
    expect(grantableRoles("MEMBER")).toEqual(["GUEST"]);
    expect(grantableRoles("GUEST")).toEqual([]);
  });
});

describe("org member rank policy: role changes", () => {
  it("role change = target reachable + new role grantable", () => {
    expect(canChangeRole("OWNER", "MEMBER", "ADMIN")).toBe(true);
    expect(canChangeRole("OWNER", "ADMIN", "MEMBER")).toBe(true);
    expect(canChangeRole("OWNER", "MEMBER", "OWNER")).toBe(false);
    expect(canChangeRole("OWNER", "OWNER", "MEMBER")).toBe(false);

    expect(canChangeRole("ADMIN", "MEMBER", "LEAD")).toBe(true);
    expect(canChangeRole("ADMIN", "LEAD", "GUEST")).toBe(true);
    expect(canChangeRole("ADMIN", "MEMBER", "ADMIN")).toBe(false);
    expect(canChangeRole("ADMIN", "ADMIN", "MEMBER")).toBe(false);

    expect(canChangeRole("LEAD", "MEMBER", "GUEST")).toBe(true);
    expect(canChangeRole("LEAD", "GUEST", "MEMBER")).toBe(true);
    expect(canChangeRole("LEAD", "MEMBER", "LEAD")).toBe(false); // nobody makes a peer
    expect(canChangeRole("LEAD", "LEAD", "MEMBER")).toBe(false); // nor touches one
    expect(canChangeRole("LEAD", "MEMBER", "ADMIN")).toBe(false);

    expect(canChangeRole("MEMBER", "GUEST", "MEMBER")).toBe(false);
    expect(canChangeRole("MEMBER", "MEMBER", "GUEST")).toBe(false);
    expect(canChangeRole("MEMBER", "MEMBER", "LEAD")).toBe(false);
    expect(canChangeRole("MEMBER", "LEAD", "MEMBER")).toBe(false);

    for (const target of ROLES) for (const to of ROLES) expect(canChangeRole("GUEST", target, to)).toBe(false);
  });
});

describe("account status transitions", () => {
  const FROM: MemberStatus[] = ["ACTIVE", "SUSPENDED", "OFFBOARDED"];
  it("suspend from ACTIVE; reactivate from SUSPENDED or OFFBOARDED; offboard from ACTIVE or SUSPENDED", () => {
    expect(FROM.map((s) => canTransitionStatus("suspend", s))).toEqual([true, false, false]);
    expect(FROM.map((s) => canTransitionStatus("reactivate", s))).toEqual([false, true, true]);
    expect(FROM.map((s) => canTransitionStatus("offboard", s))).toEqual([true, true, false]);
  });
});

describe("granting capabilities", () => {
  const owner = { role: "OWNER" as OrgRole, caps: effectiveCapabilities({ role: "OWNER" }) };
  const admin = { role: "ADMIN" as OrgRole, caps: effectiveCapabilities({ role: "ADMIN" }) };
  const hrMember = { role: "MEMBER" as OrgRole, caps: effectiveCapabilities({ role: "MEMBER", capabilities: ["users.manage"] }) };

  it("only what the caller holds themselves (the OWNER holds everything)", () => {
    expect(capabilityChangeProblem(owner, "MEMBER", "cash.view")).toBeNull();
    expect(capabilityChangeProblem(admin, "MEMBER", "announce.send")).toBeNull();
    expect(capabilityChangeProblem(admin, "MEMBER", "cash.view")).toBe("accounts.cap_not_held");
    expect(capabilityChangeProblem(hrMember, "MEMBER", "users.manage")).toBeNull();
    expect(capabilityChangeProblem(hrMember, "MEMBER", "prices.view")).toBe("accounts.cap_not_held");
  });

  it("never to a guest, never archive.view, never an unknown name", () => {
    for (const cap of CAPABILITIES) {
      expect(capabilityChangeProblem(owner, "GUEST", cap)).toBe(cap === "archive.view" ? "accounts.cap_owner_only" : "accounts.cap_not_for_guests");
    }
    for (const role of ["ADMIN", "LEAD", "MEMBER"] as OrgRole[]) {
      expect(capabilityChangeProblem(owner, role, "archive.view")).toBe("accounts.cap_owner_only");
    }
    expect(capabilityChangeProblem(owner, "MEMBER", "foo.bar")).toBe("accounts.cap_unknown");
    expect(capabilityChangeProblem(owner, "OWNER", "cash.view")).toBe("accounts.cap_owner_has_all");
  });
});

describe("rank defaults the caller does not hold (review B, M2)", () => {
  const owner = { role: "OWNER" as OrgRole, caps: effectiveCapabilities({ role: "OWNER" }) };
  const adminWithoutPrices = { role: "ADMIN" as OrgRole, caps: effectiveCapabilities({ role: "ADMIN", revokedCapabilities: ["prices.view"] }) };
  const leadWithoutEdit = {
    role: "LEAD" as OrgRole,
    caps: effectiveCapabilities({ role: "LEAD", capabilities: ["users.manage"], revokedCapabilities: ["crm.edit"] }),
  };

  it("are switched off on the account the caller makes or re-ranks: nobody produces more than they hold", () => {
    expect(unheldRankDefaults(adminWithoutPrices, "LEAD")).toEqual(["prices.view"]);
    expect(unheldRankDefaults(adminWithoutPrices, "MEMBER")).toEqual([]);
    expect(unheldRankDefaults(leadWithoutEdit, "MEMBER")).toEqual(["crm.edit"]);
    expect(unheldRankDefaults(leadWithoutEdit, "GUEST")).toEqual([]);
  });

  it("the OWNER holds everything; an explicit extra the person already has is not switched off", () => {
    for (const role of ROLES) expect(unheldRankDefaults(owner, role)).toEqual([]);
    expect(unheldRankDefaults(adminWithoutPrices, "LEAD", ["prices.view"])).toEqual([]);
  });
});

describe("replacing a capability list", () => {
  const admin = { role: "ADMIN" as OrgRole, caps: effectiveCapabilities({ role: "ADMIN" }) };
  const owner = { role: "OWNER" as OrgRole, caps: effectiveCapabilities({ role: "OWNER" }) };

  it("judges what changes: an addition must be grantable and held", () => {
    expect(replaceCapabilityList(admin, "MEMBER", [], ["announce.send"])).toEqual({ next: ["announce.send"], problem: null });
    expect(replaceCapabilityList(admin, "MEMBER", [], ["cash.view"]).problem).toBe("accounts.cap_not_held");
    expect(replaceCapabilityList(owner, "MEMBER", [], ["archive.view"]).problem).toBe("accounts.cap_owner_only");
  });

  it("leaves alone what the caller does not change (an owner's grant survives an admin's edit)", () => {
    expect(replaceCapabilityList(admin, "MEMBER", ["cash.view"], ["cash.view", "announce.send"])).toEqual({
      next: ["announce.send", "cash.view"],
      problem: null,
    });
  });

  it("a removal must be held too: an ADMIN cannot take away what only the OWNER could give", () => {
    expect(replaceCapabilityList(admin, "MEMBER", ["cash.view"], []).problem).toBe("accounts.cap_not_held");
    expect(replaceCapabilityList(owner, "MEMBER", ["cash.view"], [])).toEqual({ next: [], problem: null });
  });

  it("a guest holds no list at all: anything asked for is refused, anything stored is cleared", () => {
    expect(replaceCapabilityList(owner, "GUEST", [], ["crm.view"]).problem).toBe("accounts.cap_not_for_guests");
    expect(replaceCapabilityList(owner, "GUEST", ["crm.view", "cash.view"], undefined)).toEqual({ next: [], problem: null });
    expect(replaceCapabilityList(owner, "GUEST", ["crm.view"], [])).toEqual({ next: [], problem: null });
  });

  it("drops what the role can no longer hold and stale names, without asking the caller to hold them", () => {
    expect(replaceCapabilityList(admin, "MEMBER", ["archive.view", "foo.bar"], undefined)).toEqual({ next: [], problem: null });
    expect(replaceCapabilityList(admin, "MEMBER", ["foo.bar"], [])).toEqual({ next: [], problem: null });
  });

  it("removes duplicates and keeps the catalogue order", () => {
    expect(replaceCapabilityList(owner, "LEAD", [], ["cash.view", "crm.edit", "cash.view", "announce.send"]).next).toEqual([
      "crm.edit",
      "announce.send",
      "cash.view",
    ]);
  });
});

describe("manager chains", () => {
  const chain = new Map<string, string | null>([
    ["a", "b"], // a reports to b
    ["b", "c"],
    ["c", null],
    ["x", "y"], // an old loop that does not involve anybody below
    ["y", "x"],
  ]);

  it("nobody manages themselves, directly or around a loop", () => {
    expect(wouldCreateManagerCycle(chain, "a", "a")).toBe(true);
    expect(wouldCreateManagerCycle(chain, "c", "a")).toBe(true); // c -> a -> b -> c
    expect(wouldCreateManagerCycle(chain, "b", "a")).toBe(true);
  });

  it("a chain that does not come back is fine, and an unrelated loop in old data does not hang", () => {
    expect(wouldCreateManagerCycle(chain, "d", "a")).toBe(false);
    expect(wouldCreateManagerCycle(chain, "a", "c")).toBe(false);
    expect(wouldCreateManagerCycle(chain, "d", "x")).toBe(false);
  });
});
