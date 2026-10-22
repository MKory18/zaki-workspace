import { describe, expect, it } from "vitest";
import { ARTICLE_AUDIENCE, AUDIENCES, audienceOf, canRead } from "@/lib/guide/audience";
import { CAPABILITIES, effectiveCapabilities } from "@/server/policy/capabilities";

describe("canRead: who may read what", () => {
  it("a guest reads only what is for everyone, staff add the staff material, managers read all three", () => {
    expect(AUDIENCES).toEqual(["everyone", "staff", "managers"]);
    expect(AUDIENCES.filter((a) => canRead("everyone", a))).toEqual(["everyone"]);
    expect(AUDIENCES.filter((a) => canRead("staff", a))).toEqual(["everyone", "staff"]);
    expect(AUDIENCES.filter((a) => canRead("managers", a))).toEqual(["everyone", "staff", "managers"]);
  });
});

describe("audienceOf: the viewer's level is decided by the actor, never by what the browser says", () => {
  const none: readonly string[] = [];

  it("an external partner is 'everyone', whatever else the row says", () => {
    expect(audienceOf({ isExternal: true, caps: none })).toBe("everyone");
    // a guest can never hold a capability, but a stray value must not promote them
    expect(audienceOf({ isExternal: true, caps: ["users.manage"] })).toBe("everyone");
  });

  it("whoever holds users.manage is a manager (the owner holds every capability)", () => {
    expect(audienceOf({ isExternal: false, caps: ["users.manage"] })).toBe("managers");
    expect(audienceOf({ isExternal: false, caps: new Set(CAPABILITIES) })).toBe("managers");
  });

  it("everybody else on the team is staff", () => {
    expect(audienceOf({ isExternal: false, caps: none })).toBe("staff");
    expect(audienceOf({ isExternal: false, caps: ["spaces.create", "directory.view"] })).toBe("staff");
  });

  it("reads the Set that requireActor returns as well as a plain array", () => {
    expect(audienceOf({ isExternal: false, caps: new Set(["users.manage"]) })).toBe("managers");
    expect(audienceOf({ isExternal: false, caps: new Set(["crm.view"]) })).toBe("staff");
  });

  it("follows the rank defaults: an admin manages, a team lead and a member do not, a guest never", () => {
    const level = (role: "OWNER" | "ADMIN" | "LEAD" | "MEMBER" | "GUEST", extra: string[] = [], revoked: string[] = []) =>
      audienceOf({
        isExternal: role === "GUEST",
        caps: effectiveCapabilities({ role, capabilities: extra, revokedCapabilities: revoked }),
      });
    expect(level("OWNER")).toBe("managers");
    expect(level("ADMIN")).toBe("managers");
    expect(level("LEAD")).toBe("staff");
    expect(level("MEMBER")).toBe("staff");
    expect(level("GUEST")).toBe("everyone");
    // the switch decides, not the rank
    expect(level("MEMBER", ["users.manage"])).toBe("managers");
    expect(level("ADMIN", [], ["users.manage"])).toBe("staff");
  });
});

describe("ARTICLE_AUDIENCE: the one table of who an article is for", () => {
  it("only the people article is closed to staff, and only manager-level material says so", () => {
    expect(ARTICLE_AUDIENCE.team).toBe("managers");
    expect(ARTICLE_AUDIENCE.start).toBe("everyone");
    expect(ARTICLE_AUDIENCE.tasks).toBe("staff");
    for (const level of Object.values(ARTICLE_AUDIENCE)) expect(AUDIENCES).toContain(level);
  });
});
