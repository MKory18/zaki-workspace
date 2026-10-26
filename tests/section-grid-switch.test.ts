import { describe, expect, it } from "vitest";
import { CAPABILITIES, can, effectiveCapabilities } from "@/server/policy/capabilities";
import { FEATURES, FEATURE_DEFAULTS, featureOn } from "@/lib/features";
import { capabilityGroups, resetCapabilityLists, sectionGrid, type ActorInfo } from "@/lib/members-ui";
import { MEMBER, OWNER_ACTOR, contractMember } from "./members-ui-fixtures";

/**
 * «صلاحيات الأقسام» in «الميزات» (the owner's rule, 2026-10-26: every new feature can be switched off and the site is
 * as before it). Off: every section box is the rank's template, the stored boxes are kept for later, and the customers'
 * two switches are switches again.
 */
const OFF = { sectionGrid: false } as const;

describe("the switch", () => {
  it("is a key of «الميزات», on unless the owner turns it off", () => {
    expect(FEATURES).toContain("sectionPermissions");
    expect(FEATURE_DEFAULTS.sectionPermissions).toBe(true);
    expect(featureOn({}, "sectionPermissions")).toBe(true);
    expect(featureOn({ features: { sectionPermissions: false } }, "sectionPermissions")).toBe(false);
  });
});

describe("off: the rank's template for every section", () => {
  it("a box taken away or given is ignored, but kept", () => {
    const member = { role: "MEMBER" as const, capabilities: ["goals.edit"], revokedCapabilities: ["ideas.view", "files.delete"] };
    expect(can(member, "ideas.view")).toBe(false);
    expect(can(member, "ideas.view", OFF)).toBe(true);
    expect(can(member, "files.delete", OFF)).toBe(true);
    expect(can(member, "goals.edit")).toBe(true);
    expect(can(member, "goals.edit", OFF)).toBe(false);
    expect(member.revokedCapabilities).toEqual(["ideas.view", "files.delete"]);
  });

  it("the customers' two switches stay switches; deleting follows editing, as before the grid", () => {
    expect(can({ role: "MEMBER", revokedCapabilities: ["crm.edit"] }, "crm.edit", OFF)).toBe(false);
    expect(can({ role: "MEMBER", revokedCapabilities: ["crm.edit"] }, "crm.delete", OFF)).toBe(false);
    expect(can({ role: "MEMBER", revokedCapabilities: ["crm.delete"] }, "crm.delete", OFF)).toBe(true);
    // and independent again: no view still lets the person write, as it did
    expect(can({ role: "MEMBER", revokedCapabilities: ["crm.view"] }, "crm.edit", OFF)).toBe(true);
  });

  it("a partner gets every section back; the switches the primary owner took stay taken", () => {
    const partner = { role: "OWNER" as const, primaryOwner: false, revokedCapabilities: ["ideas.view", "users.manage"] };
    const caps = effectiveCapabilities(partner, OFF);
    expect(caps.has("ideas.view")).toBe(true);
    expect(caps.has("users.manage")).toBe(false);
    expect([...effectiveCapabilities({ role: "OWNER", primaryOwner: true }, OFF)].sort()).toEqual([...CAPABILITIES].sort());
    expect(effectiveCapabilities({ role: "GUEST", capabilities: ["ideas.view"] }, OFF).size).toBe(0);
  });
});

describe("off: the member's sheet", () => {
  const offActor: ActorInfo = { ...OWNER_ACTOR, sectionGrid: false };

  it("has no section grid, and the customers' two switches are back", () => {
    expect(sectionGrid(MEMBER, offActor, true)).toEqual([]);
    expect(sectionGrid(MEMBER, OWNER_ACTOR, true).length).toBeGreaterThan(0);
    const switches = capabilityGroups(MEMBER, offActor, true).flatMap((g) => g.rows.map((r) => r.capability));
    expect(switches).toEqual(expect.arrayContaining(["crm.view", "crm.edit"]));
    const on = capabilityGroups(MEMBER, OWNER_ACTOR, true).flatMap((g) => g.rows.map((r) => r.capability));
    expect(on).not.toContain("crm.view");
  });

  it("«back to the rank» leaves the hidden boxes stored for when it is on again", () => {
    const changed = contractMember({ ...MEMBER, capabilities: ["integrations.manage", "goals.edit"], revokedCapabilities: ["ideas.view"] });
    const next = resetCapabilityLists(changed, offActor);
    expect(next.capabilities).toEqual(["goals.edit"]);
    expect(next.revokedCapabilities).toEqual(["ideas.view"]);
  });
});
