import { describe, expect, it } from "vitest";
import { AR } from "@/lib/i18n/dict";

/**
 * The owner calls the parts inside a space «مقاطع» (2026-10-25), so every string of that feature says «مقطع/مقاطع».
 * «الفريق» elsewhere (the people directory, «قائد فريق») is a different thing and is not touched here.
 */
const SECTION_KEYS = Object.keys(AR).filter(
  (k) => k.startsWith("spaceteams.") || /^teams\.(not_found|name_taken|not_empty|member_not_in_space|lead_not_member|not_member)$/.test(k) || k === "assignee.not_in_team",
);

describe("the sections inside a space are called «مقاطع»", () => {
  it("the dialog and the pickers", () => {
    expect(AR["spaceteams.title"]).toBe("المقاطع");
    expect(AR["spaceteams.picker"]).toBe("المقطع");
    expect(AR["spaceteams.move"]).toBe("نقل إلى مقطع");
    expect(AR["spaceteams.create"]).toBe("افتح مقطع");
  });

  it("no string of the feature says «فريق» or «فرق»", () => {
    expect(SECTION_KEYS.length).toBe(19);
    for (const k of SECTION_KEYS) expect(AR[k], k).not.toMatch(/فريق|فرق|الفرق/);
  });
});
