import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";
import { PRIORITY_STYLES, isOverdue, formatDate } from "@/lib/format";

describe("utils.cn", () => {
  it("merges conflicting tailwind classes (last wins)", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
    expect(cn("text-sm", "text-red-500")).toContain("text-red-500");
  });
});

describe("format", () => {
  it("maps every priority to a presentation token", () => {
    for (const key of ["URGENT", "HIGH", "NORMAL", "LOW", "NONE"]) {
      expect(PRIORITY_STYLES[key]).toBeDefined();
    }
  });

  it("flags overdue dates only when in the past", () => {
    expect(isOverdue("2000-01-01")).toBe(true);
    expect(isOverdue("3020-01-01")).toBe(false);
    expect(isOverdue(null)).toBe(false);
  });

  it("formats dates deterministically", () => {
    // en locale path used in the current UI
    expect(formatDate(new Date("15 March 2030"), "en")).toMatch(/15/);
  });
});
