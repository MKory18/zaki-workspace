import { describe, expect, it } from "vitest";
import { RANK_DEFAULTS, SECTIONS, SECTION_CAPABILITIES, WIRED_CAPABILITIES, can, effectiveCapabilities } from "@/server/policy/capabilities";
import { sectionGrid, type ActorInfo } from "@/lib/members-ui";
import { ADMIN_ACTOR, MEMBER, OWNER_ACTOR, contractMember } from "./members-ui-fixtures";

/**
 * The per-person section grid (the owner's decision, 2026-10-26): «يشوف / يضيف ويعدّل / يحذف» for every section. The
 * rank templates give exactly what each rank could do before the grid, and a section one can not see can not be changed.
 */
describe("section grid: the policy", () => {
  it("every section box is a wired capability, and the grid lists each section's actions", () => {
    for (const cap of SECTION_CAPABILITIES) expect(WIRED_CAPABILITIES, cap).toContain(cap);
    expect(SECTIONS.map((s) => s.id)).toEqual(["ideas", "goals", "production", "files", "tickets", "campaigns", "crm", "reports"]);
    expect(SECTION_CAPABILITIES).toContain("reports.view");
    expect(SECTION_CAPABILITIES).not.toContain("reports.edit" as never);
  });

  it("the templates are today's rules: ideas for all staff, goals and routines managed by admins, reports from lead up", () => {
    for (const role of ["ADMIN", "LEAD", "MEMBER"] as const) {
      for (const cap of ["ideas.view", "ideas.edit", "ideas.delete", "goals.view", "production.view"] as const) {
        expect(can({ role }, cap), `${role} ${cap}`).toBe(true);
      }
    }
    for (const cap of ["goals.edit", "goals.delete", "production.edit", "production.delete"] as const) {
      expect(can({ role: "ADMIN" }, cap), cap).toBe(true);
      expect(can({ role: "LEAD" }, cap), cap).toBe(false);
      expect(can({ role: "MEMBER" }, cap), cap).toBe(false);
    }
    // batch 2: the library, the tickets, the campaigns and the customers are all staff's, delete included
    for (const role of ["ADMIN", "LEAD", "MEMBER"] as const) {
      for (const section of ["files", "tickets", "campaigns", "crm"]) {
        for (const action of ["view", "edit", "delete"]) expect(can({ role }, `${section}.${action}` as never), `${role} ${section}.${action}`).toBe(true);
      }
    }
    expect(can({ role: "LEAD" }, "reports.view")).toBe(true);
    expect(can({ role: "MEMBER" }, "reports.view")).toBe(false);
    expect(RANK_DEFAULTS.GUEST).toEqual([]);
    for (const cap of SECTION_CAPABILITIES) expect(can({ role: "GUEST", capabilities: [cap] }, cap), cap).toBe(false);
  });

  it("without «يشوف» a section's add/edit and delete are gone, for anyone below the primary owner", () => {
    const blind = effectiveCapabilities({ role: "ADMIN", revokedCapabilities: ["goals.view"] });
    expect(blind.has("goals.edit")).toBe(false);
    expect(blind.has("goals.delete")).toBe(false);
    expect(blind.has("ideas.edit")).toBe(true);
    // an extra «يضيف ويعدّل» given to someone who can not see the section does nothing
    expect(can({ role: "MEMBER", capabilities: ["production.edit"], revokedCapabilities: ["production.view"] }, "production.edit")).toBe(false);
    // a partner too
    const partner = effectiveCapabilities({ role: "OWNER", primaryOwner: false, revokedCapabilities: ["ideas.view"] });
    expect(partner.has("ideas.delete")).toBe(false);
    expect(partner.has("goals.delete")).toBe(true);
    expect(effectiveCapabilities({ role: "OWNER", primaryOwner: true }).has("ideas.delete")).toBe(true);
    // the customers joined the grid: without «يشوف» their add/edit and delete fall too
    const noCrm = effectiveCapabilities({ role: "MEMBER", revokedCapabilities: ["crm.view"] });
    expect(noCrm.has("crm.edit")).toBe(false);
    expect(noCrm.has("crm.delete")).toBe(false);
  });
});

describe("section grid: the screen's model", () => {
  const cellsOf = (member = MEMBER, actor: ActorInfo = OWNER_ACTOR, editable = true) =>
    new Map(sectionGrid(member, actor, editable).map((row) => [row.section, row.cells]));

  it("a row per section with «يشوف / يضيف ويعدّل / يحذف», the reports only «يشوف»", () => {
    const grid = cellsOf();
    expect([...grid.keys()]).toEqual(["ideas", "goals", "production", "files", "tickets", "campaigns", "crm", "reports"]);
    expect(grid.get("reports")?.edit).toBeNull();
    expect(grid.get("reports")?.delete).toBeNull();
    const goals = grid.get("goals")!;
    expect(goals.view?.on).toBe(true);
    expect(goals.edit?.on).toBe(false);
    expect(goals.edit?.customized).toBe(false);
    expect(goals.edit?.locked).toBeNull();
  });

  it("a box changed from the template is marked; a section switched off locks its other boxes", () => {
    const changed = contractMember({ ...MEMBER, capabilities: ["goals.edit"], revokedCapabilities: ["ideas.view"] });
    const grid = cellsOf(changed);
    expect(grid.get("goals")?.edit?.on).toBe(true);
    expect(grid.get("goals")?.edit?.customized).toBe(true);
    const ideas = grid.get("ideas")!;
    expect(ideas.view?.on).toBe(false);
    expect(ideas.view?.customized).toBe(true);
    expect(ideas.edit?.on).toBe(false);
    expect(ideas.edit?.needsView).toBe(true);
    expect(ideas.edit?.locked).not.toBeNull();
    expect(ideas.view?.locked).toBeNull();
  });

  it("read-only for whoever may not edit the person, and nobody hands out a box they lack", () => {
    for (const row of sectionGrid(MEMBER, OWNER_ACTOR, false)) {
      for (const cell of Object.values(row.cells)) if (cell) expect(cell.locked).toBe("readonly");
    }
    const lead: ActorInfo = { id: "u-lead", role: "LEAD", caps: [...RANK_DEFAULTS.LEAD, "users.manage"] };
    const grid = cellsOf(MEMBER, lead);
    expect(grid.get("goals")?.edit?.locked).toBe("actor_lacks");
    expect(grid.get("ideas")?.delete?.locked).toBeNull();
    expect(cellsOf(MEMBER, ADMIN_ACTOR).get("goals")?.edit?.locked).toBeNull();
  });
});
