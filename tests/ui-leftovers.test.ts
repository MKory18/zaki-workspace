import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AR } from "@/lib/i18n/dict";

/**
 * Review C items 14 and 15: one name for the company, «الشركة» (review A item 13), everywhere; and the
 * focus and "today" rings are solid, never a translucent accent that loses its contrast.
 */
describe("one name for the company", () => {
  it("no dictionary string says «مؤسسة»: it is «الشركة»", () => {
    const offenders = Object.entries(AR).filter(([, v]) => /مؤسس/.test(v)).map(([k, v]) => `${k}: ${v}`);
    expect(offenders).toEqual([]);
  });

  it("the goals refusal names the goals, not «الأهداف والفكرة»", () => {
    expect(AR["goals.role_denied"]).toBe("إدارة الأهداف متاحة لصاحب القرار في الشركة فقط");
  });
});

describe("rings are solid", () => {
  it("the bell, the list filters and today's calendar cell use a solid accent ring", () => {
    for (const file of ["src/components/notification-bell.tsx", "src/components/list-filters.tsx", "src/components/calendar-grid.tsx"]) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/ring-accent\/\d+/);
    }
  });
});
