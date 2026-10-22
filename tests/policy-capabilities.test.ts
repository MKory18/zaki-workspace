import { describe, expect, it } from "vitest";
import {
  CAPABILITIES,
  RANK_DEFAULTS,
  can,
  effectiveCapabilities,
  grantProblem,
  isCapability,
} from "../src/server/policy/capabilities";
import { CREATABLE_ROLES, atLeast, outranks, rankOf } from "../src/server/policy/rank";
import { DEFAULT_TRANSPARENCY_VERSION, onboardingStateOf, transparencyVersionOf } from "../src/server/policy/org-settings";

describe("rank", () => {
  it("orders OWNER > ADMIN > LEAD > MEMBER > GUEST", () => {
    expect(rankOf("OWNER")).toBeGreaterThan(rankOf("ADMIN"));
    expect(rankOf("ADMIN")).toBeGreaterThan(rankOf("LEAD"));
    expect(rankOf("LEAD")).toBeGreaterThan(rankOf("MEMBER"));
    expect(rankOf("MEMBER")).toBeGreaterThan(rankOf("GUEST"));
    expect(outranks("LEAD", "MEMBER")).toBe(true);
    expect(outranks("MEMBER", "MEMBER")).toBe(false);
    expect(atLeast("MEMBER", "MEMBER")).toBe(true);
    expect(atLeast("GUEST", "MEMBER")).toBe(false);
  });

  it("there is exactly one OWNER: it can never be the role of a newly created account", () => {
    expect(CREATABLE_ROLES).not.toContain("OWNER");
    expect(CREATABLE_ROLES).toEqual(["ADMIN", "LEAD", "MEMBER", "GUEST"]);
  });
});

describe("capabilities", () => {
  it("the OWNER can do everything, including the owner-only archive", () => {
    expect([...effectiveCapabilities({ role: "OWNER" })].sort()).toEqual([...CAPABILITIES].sort());
  });

  it("rank defaults: an ADMIN manages users and integrations, a MEMBER does neither", () => {
    expect(can({ role: "ADMIN" }, "users.manage")).toBe(true);
    expect(can({ role: "ADMIN" }, "integrations.manage")).toBe(true);
    expect(can({ role: "MEMBER" }, "users.manage")).toBe(false);
    expect(can({ role: "MEMBER" }, "integrations.manage")).toBe(false);
    expect(can({ role: "LEAD" }, "directory.view")).toBe(true);
  });

  it("the owner can switch a single capability on for a person (the automation person)", () => {
    expect(can({ role: "MEMBER", capabilities: ["integrations.manage"] }, "integrations.manage")).toBe(true);
  });

  it("...or off (an admin who must not see prices)", () => {
    expect(can({ role: "ADMIN", revokedCapabilities: ["prices.view"] }, "prices.view")).toBe(false);
    expect(can({ role: "ADMIN", revokedCapabilities: ["prices.view"] }, "crm.view")).toBe(true);
  });

  it("an external partner (GUEST) holds NO capability, even if one was stored for them", () => {
    expect(effectiveCapabilities({ role: "GUEST" }).size).toBe(0);
    for (const c of CAPABILITIES) expect(can({ role: "GUEST", capabilities: [c] }, c), c).toBe(false);
    expect(RANK_DEFAULTS.GUEST).toEqual([]);
  });

  it("the archive/oversight capability can never be handed to anyone below the owner", () => {
    for (const role of ["ADMIN", "LEAD", "MEMBER"] as const) {
      expect(can({ role, capabilities: ["archive.view"] }, "archive.view"), role).toBe(false);
    }
  });

  it("unknown capability names stored in the database are ignored, not trusted", () => {
    expect(isCapability("users.manage")).toBe(true);
    expect(isCapability("root")).toBe(false);
    expect(can({ role: "MEMBER", capabilities: ["root", "users.manage" as never] }, "users.manage")).toBe(true);
    expect(effectiveCapabilities({ role: "MEMBER", capabilities: ["root"] }).size).toBe(RANK_DEFAULTS.MEMBER.length);
  });

  it("grantProblem explains why a switch is refused", () => {
    expect(grantProblem("MEMBER", "integrations.manage")).toBeNull();
    expect(grantProblem("GUEST", "crm.view")).toBe("not_for_guests");
    expect(grantProblem("ADMIN", "archive.view")).toBe("owner_only");
    expect(grantProblem("OWNER", "crm.view")).toBe("owner_has_all");
    expect(grantProblem("MEMBER", "root")).toBe("unknown_capability");
  });
});

describe("onboarding state (the transparency notice)", () => {
  it("everybody has to accept the notice once: a user who never accepted is pending", () => {
    expect(onboardingStateOf({ mustChangePassword: false, transparencyVersion: null }, {})).toEqual({
      mustChangePassword: false,
      transparencyPending: true,
    });
  });

  it("accepting the current version clears it; a later version makes everybody accept again", () => {
    const accepted = { mustChangePassword: false, transparencyVersion: DEFAULT_TRANSPARENCY_VERSION };
    expect(onboardingStateOf(accepted, {}).transparencyPending).toBe(false);
    expect(onboardingStateOf(accepted, { transparencyVersion: 2 }).transparencyPending).toBe(true);
  });

  it("a temporary password is reported", () => {
    expect(onboardingStateOf({ mustChangePassword: true, transparencyVersion: 1 }, {}).mustChangePassword).toBe(true);
  });

  it("broken settings JSON falls back to the default version instead of locking everybody out", () => {
    expect(transparencyVersionOf({ transparencyVersion: "two" })).toBe(DEFAULT_TRANSPARENCY_VERSION);
    expect(transparencyVersionOf(null)).toBe(DEFAULT_TRANSPARENCY_VERSION);
    expect(transparencyVersionOf({ transparencyVersion: 3, other: 1 })).toBe(3);
  });
});
