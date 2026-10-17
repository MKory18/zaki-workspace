import { describe, expect, it } from "vitest";
import { canManageDepartments } from "../src/server/services/departments";
import { DEPARTMENT_COLORS } from "../src/server/services/departments";

/** Pure stats: the reduce behind a department card (open/overdue from raw task rows). */
function deptStats(tasks: { completedAt: Date | null; dueDate: Date | null }[]) {
  const now = new Date();
  const alive = tasks.filter((t) => !t.completedAt);
  return {
    open: alive.length,
    overdue: alive.filter((t) => t.dueDate && t.dueDate < now).length,
  };
}

describe("department policy", () => {
  it("OWNER/ADMIN manage; MEMBER and GUEST do not", () => {
    expect(canManageDepartments("OWNER")).toBe(true);
    expect(canManageDepartments("ADMIN")).toBe(true);
    expect(canManageDepartments("MEMBER")).toBe(false);
    expect(canManageDepartments("GUEST")).toBe(false);
  });

  it("the palette is stable for the picker", () => {
    expect(DEPARTMENT_COLORS).toContain("sky");
    expect(DEPARTMENT_COLORS).toHaveLength(6);
  });
});

describe("department card stats", () => {
  it("counts open and overdue correctly", () => {
    const past = new Date(Date.now() - 86_400_000);
    const future = new Date(Date.now() + 86_400_000);
    const stats = deptStats([
      { completedAt: null, dueDate: past },
      { completedAt: null, dueDate: future },
      { completedAt: new Date(), dueDate: past }, // completed, no longer overdue
      { completedAt: null, dueDate: null },
    ]);
    expect(stats.open).toBe(3);
    expect(stats.overdue).toBe(1);
  });
});
