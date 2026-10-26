import { describe, expect, it } from "vitest";
import { FEATURES, FEATURE_DEFAULTS, featureOn, featuresOf, featuresOff, isFeatureKey, withFeature } from "@/lib/features";
import { buildNav } from "@/lib/nav/places";
import { newActionsFor } from "@/lib/nav/new-actions";
import { effectiveCapabilities } from "@/server/policy/capabilities";
import { AR } from "@/lib/i18n/dict";

const owner = { role: "OWNER" as const, caps: [...effectiveCapabilities({ role: "OWNER" })] };

describe("«الميزات»: the owner's switches", () => {
  it("every key has a default and its two lines in Arabic (a key added without them fails here)", () => {
    expect(FEATURES.length).toBeGreaterThan(0);
    expect(new Set(FEATURES).size).toBe(FEATURES.length);
    for (const key of FEATURES) {
      expect(typeof FEATURE_DEFAULTS[key], key).toBe("boolean");
      expect(AR[`features.${key}.name`], key).toMatch(/[؀-ۿ]/);
      expect(AR[`features.${key}.hint`], key).toMatch(/[؀-ۿ]/);
    }
  });

  it("a switch nobody touched is its default; a stored one wins", () => {
    expect(featureOn({}, "watch")).toBe(FEATURE_DEFAULTS.watch);
    expect(featureOn(null, "watch")).toBe(FEATURE_DEFAULTS.watch);
    expect(featureOn({ features: { watch: false } }, "watch")).toBe(false);
    expect(featureOn({ features: { watch: true } }, "watch")).toBe(true);
  });

  it("a broken stored value is ignored, never read as off", () => {
    for (const settings of [{ features: "nope" }, { features: { watch: "false" } }, { features: { watch: 0 } }, "x", 42]) {
      expect(featureOn(settings, "watch"), JSON.stringify(settings)).toBe(FEATURE_DEFAULTS.watch);
    }
  });

  it("lists every switch with its default filled in, and the ones that are off", () => {
    expect(featuresOf({ features: { watch: false, unknown: true } })).toEqual({ watch: false, sectionPermissions: true, libraryDrive: true, pushEverything: true });
    expect(featuresOff({ features: { watch: false } })).toEqual(["watch"]);
    expect(featuresOff({})).toEqual([]);
  });

  it("setting one switch keeps every other key of the company's settings", () => {
    const before = { transparencyVersion: 3, features: { other: true }, somethingElse: { a: 1 } };
    expect(withFeature(before, "watch", false)).toEqual({ transparencyVersion: 3, features: { other: true, watch: false }, somethingElse: { a: 1 } });
    expect(withFeature(null, "watch", true)).toEqual({ features: { watch: true } });
  });

  it("knows its own keys and nothing else", () => {
    expect(isFeatureKey("watch")).toBe(true);
    expect(isFeatureKey("nope")).toBe(false);
    expect(isFeatureKey(1)).toBe(false);
  });
});

describe("«الميزات»: a switched-off feature is gone from the map and from «جديد»", () => {
  it("«نتفرّج سوا» off: no sixth place, no «جديد» entry; on again: both back", () => {
    expect(buildNav({ ...owner, off: ["watch"] }).places.map((p) => p.key)).not.toContain("watch");
    expect(newActionsFor({ ...owner, off: ["watch"] })).not.toContain("watch");
    expect(buildNav({ ...owner, off: [] }).places.map((p) => p.key)).toContain("watch");
    expect(newActionsFor(owner)).toContain("watch");
  });

  it("switching a feature off changes nothing else on the map", () => {
    const on = buildNav(owner).places.filter((p) => p.key !== "watch");
    expect(buildNav({ ...owner, off: ["watch"] }).places).toEqual(on);
  });
});
