import { describe, expect, it } from "vitest";
import { AR } from "@/lib/i18n/dict";
import { FEATURE_DEFAULTS, featureOn } from "@/lib/features";
import { buildNav, canOpenTab, offeredToGuests } from "@/lib/nav/places";
import { MAX_LINE_DEPTH, SKILL_LEVELS, childrenOf, depthAbove, exceedsLineDepth, heightBelow, isSkillLevel, skillGap, subtreeOf } from "@/lib/team-development";
import { CAPABILITIES, RANK_DEFAULTS, can, effectiveCapabilities, grantProblem } from "@/server/policy/capabilities";
import { CAPABILITY_GROUPS, isOffered } from "@/lib/members-ui";
import { enumLabel } from "@/lib/i18n/enums";

/** «الأداء والتطوير», part 1 — the pure rules: reporting-line arithmetic, the two capabilities, the switch and the tabs. */

const lines = (pairs: [string, string | null][]) => new Map(pairs);

describe("reporting lines: subtree, depth, loops", () => {
  //  o ── a ── b ── c        o ── d
  const chain = lines([["o", null], ["a", "o"], ["b", "a"], ["c", "b"], ["d", "o"]]);

  it("subtreeOf lists everybody below, direct and indirect, never the root", () => {
    expect(subtreeOf(chain, "o").sort()).toEqual(["a", "b", "c", "d"]);
    expect(subtreeOf(chain, "a").sort()).toEqual(["b", "c"]);
    expect(subtreeOf(chain, "c")).toEqual([]);
    expect(subtreeOf(chain, "nobody")).toEqual([]);
    expect([...childrenOf(chain).get("o")!].sort()).toEqual(["a", "d"]);
  });

  it("depthAbove and heightBelow count the levels", () => {
    expect(depthAbove(chain, "o")).toBe(0);
    expect(depthAbove(chain, "c")).toBe(3);
    expect(heightBelow(chain, "o")).toBe(3);
    expect(heightBelow(chain, "a")).toBe(2);
    expect(heightBelow(chain, "c")).toBe(0);
  });

  it("old data with a loop cannot hang any walk", () => {
    const loop = lines([["a", "b"], ["b", "c"], ["c", "a"]]);
    expect(subtreeOf(loop, "a").sort()).toEqual(["b", "c"]);
    expect(depthAbove(loop, "a")).toBeLessThanOrEqual(3);
    expect(heightBelow(loop, "a")).toBeLessThanOrEqual(3);
  });

  it("exceedsLineDepth: nobody gets more than 6 supervisors above them", () => {
    const people: [string, string | null][] = [["p0", null]];
    for (let i = 1; i <= 6; i++) people.push([`p${i}`, `p${i - 1}`]);
    const six = lines([...people, ["w", null]]);
    expect(depthAbove(six, "p6")).toBe(6);
    expect(MAX_LINE_DEPTH).toBe(6);
    expect(exceedsLineDepth(six, "w", "p6")).toBe(true); // w would have 7 supervisors above
    expect(exceedsLineDepth(six, "w", "p5")).toBe(false); // 6: allowed
    expect(exceedsLineDepth(six, "w", "p0")).toBe(false);
  });

  it("exceedsLineDepth counts the moved branch: x (two levels below) under p3 is 4+2 = 6, under p4 is 7", () => {
    const people: [string, string | null][] = [["p0", null]];
    for (let i = 1; i <= 6; i++) people.push([`p${i}`, `p${i - 1}`]);
    const six = lines([...people, ["x", null], ["y", "x"], ["z", "y"]]);
    expect(exceedsLineDepth(six, "x", "p3")).toBe(false); // x=4, y=5, z=6
    expect(exceedsLineDepth(six, "x", "p4")).toBe(true); // x=5, y=6, z=7
  });

  it("the person's old place is not counted against them when they move inside the same branch", () => {
    const map = lines([["o", null], ["a", "o"], ["b", "a"]]);
    expect(exceedsLineDepth(map, "b", "o")).toBe(false);
  });
});

describe("skill levels and the gap", () => {
  it("levels are the whole numbers 0 to 4, each with its Arabic word", () => {
    expect([...SKILL_LEVELS]).toEqual([0, 1, 2, 3, 4]);
    for (const n of SKILL_LEVELS) expect(AR[`teamdev.level.${n}`], String(n)).toMatch(/[؀-ۿ]/);
    for (const bad of [-1, 5, 2.5, "3", null, undefined, Number.NaN]) expect(isSkillLevel(bad), String(bad)).toBe(false);
    expect(isSkillLevel(0)).toBe(true);
  });

  it("the gap is the supervisor's level minus the person's own, and nothing when one is missing", () => {
    expect(skillGap(4, 2)).toBe(2);
    expect(skillGap(1, 3)).toBe(-2);
    expect(skillGap(3, 3)).toBe(0);
    expect(skillGap(0, 2)).toBe(-2);
    expect(skillGap(null, 2)).toBeNull();
    expect(skillGap(2, undefined)).toBeNull();
  });

  it("the enum SkillSource is labelled without a raw key", () => {
    expect(enumLabel("SkillSource", "MANUAL")).toBe(AR["teamdev.skill.manual"]);
    expect(enumLabel("SkillSource", "SELF")).toBe(AR["teamdev.skill.self"]);
  });
});

describe("the two capabilities", () => {
  const NEW = ["people.manage_lines", "people.review"] as const;

  it("are in the catalogue and offered as switches, in their own group", () => {
    for (const c of NEW) {
      expect(CAPABILITIES).toContain(c);
      expect(isOffered(c)).toBe(true);
      expect(AR[`members.cap.${c}.title`], c).toMatch(/[؀-ۿ]/);
      expect(AR[`members.cap.${c}.hint`], c).toMatch(/[؀-ۿ]/);
    }
    expect(CAPABILITY_GROUPS.find((g) => g.id === "development")?.capabilities).toEqual([...NEW]);
    expect(AR["members.group_development"]).toBeTruthy();
  });

  it("are OFF by default for every rank but the owner's (who holds everything); the owner switches them per person", () => {
    for (const role of ["ADMIN", "LEAD", "MEMBER", "GUEST"] as const) {
      for (const c of NEW) expect(RANK_DEFAULTS[role], `${role} / ${c}`).not.toContain(c);
    }
    for (const c of NEW) expect(RANK_DEFAULTS.OWNER).toContain(c);
    expect(can({ role: "MEMBER", capabilities: ["people.review"] }, "people.review")).toBe(true);
    expect(can({ role: "MEMBER", capabilities: ["people.review"] }, "people.manage_lines")).toBe(false);
    // taken away from a partner (an OWNER who is not the primary owner), it stays off
    expect(can({ role: "OWNER", primaryOwner: false, revokedCapabilities: ["people.review"] }, "people.review")).toBe(false);
  });

  it("a guest never holds them, whatever is stored, and the owner has no «grant» problem only as a partner", () => {
    for (const c of NEW) {
      expect(effectiveCapabilities({ role: "GUEST", capabilities: [c] }).has(c)).toBe(false);
      expect(grantProblem("GUEST", c)).toBe("not_for_guests");
      expect(grantProblem("MEMBER", c)).toBeNull();
      expect(grantProblem("OWNER", c)).toBe("owner_has_all");
    }
  });
});

describe("the switch and the two tabs", () => {
  const caps = (role: "OWNER" | "ADMIN" | "LEAD" | "MEMBER" | "GUEST", extra: string[] = []) => [...effectiveCapabilities({ role, capabilities: extra })];

  it("«الأداء والتطوير» is a switch, on by default, with its name and hint", () => {
    expect(FEATURE_DEFAULTS.teamDevelopment).toBe(true);
    expect(featureOn({}, "teamDevelopment")).toBe(true);
    expect(featureOn({ features: { teamDevelopment: false } }, "teamDevelopment")).toBe(false);
    expect(AR["features.teamDevelopment.name"]).toMatch(/[؀-ۿ]/);
    expect(AR["features.teamDevelopment.hint"]).toMatch(/[؀-ۿ]/);
  });

  it("the owner sees both tabs; a plain employee neither; a supervisor, a `people.review` or `people.manage_lines` holder both; a guest neither", () => {
    expect(canOpenTab({ role: "OWNER", caps: caps("OWNER") }, "structure")).toBe(true);
    expect(canOpenTab({ role: "OWNER", caps: caps("OWNER") }, "development")).toBe(true);
    for (const role of ["ADMIN", "LEAD", "MEMBER"] as const) {
      expect(canOpenTab({ role, caps: caps(role) }, "structure"), role).toBe(false);
      expect(canOpenTab({ role, caps: caps(role) }, "development"), role).toBe(false);
      expect(canOpenTab({ role, caps: caps(role), supervisor: true }, "structure"), `${role} supervising`).toBe(true);
      expect(canOpenTab({ role, caps: caps(role), supervisor: true }, "development"), `${role} supervising`).toBe(true);
      expect(canOpenTab({ role, caps: caps(role, ["people.review"]) }, "development"), `${role} review`).toBe(true);
      expect(canOpenTab({ role, caps: caps(role, ["people.review"]) }, "structure"), `${role} review`).toBe(false);
      expect(canOpenTab({ role, caps: caps(role, ["people.manage_lines"]) }, "structure"), `${role} lines`).toBe(true);
    }
    expect(offeredToGuests("structure")).toBe(false);
    expect(offeredToGuests("development")).toBe(false);
    expect(canOpenTab({ role: "GUEST", caps: [], supervisor: true }, "structure")).toBe(false);
  });

  it("a switched-off feature draws no tab, for the owner too", () => {
    const nav = buildNav({ role: "OWNER", caps: caps("OWNER"), off: ["teamDevelopment"] });
    const tabs = nav.places.flatMap((p) => p.tabs.map((t) => t.key));
    expect(tabs).not.toContain("structure");
    expect(tabs).not.toContain("development");
    expect(canOpenTab({ role: "OWNER", caps: caps("OWNER"), off: ["teamDevelopment"] }, "structure")).toBe(false);
  });

  it("the tabs sit in «الإدارة» with the owner's words", () => {
    const admin = buildNav({ role: "OWNER", caps: caps("OWNER") }).places.find((p) => p.key === "admin");
    const keys = admin?.tabs.map((t) => t.key) ?? [];
    expect(keys).toContain("structure");
    expect(keys).toContain("development");
    expect(AR["nav.tab.structure"]).toBe("الهيكل");
    expect(AR["nav.tab.development"]).toBe("الأداء والتطوير");
  });
});
