import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Static security-contract tests.
 *
 * The repo's test suite is logic-only (no DB integration harness), so these
 * tests pin the *ordering* of authorization vs. data fetching and the
 * presence of tenant-scope validations in the source. They fail loudly if a
 * refactor reintroduces a "fetch-then-authorize" pattern or drops a scope
 * check.
 */

const root = process.cwd();
const read = (...parts: string[]) => readFileSync(join(root, ...parts), "utf8");

describe("timeline authorization ordering (P1 regression)", () => {
  const route = read("src", "app", "api", "projects", "[id]", "timeline", "route.ts");
  const page = read("src", "app", "(app)", "projects", "[id]", "timeline", "page.tsx");

  it("API route authorizes before fetching timeline data", () => {
    // the space AND the project's team (teams inside a space, 2026-10-25): requireTeamWork
    const ws = route.indexOf("await requireTeamWork");
    const data = route.indexOf("await getProjectTimeline");
    const resolve = route.indexOf("workspaceId: true, teamId: true");
    expect(ws).toBeGreaterThan(-1);
    expect(resolve).toBeGreaterThan(-1);
    // workspace resolve + requireWorkspace must both precede the data fetch
    expect(resolve).toBeLessThan(data);
    expect(ws).toBeLessThan(data);
  });

  it("SSR page checks workspace scope before fetching timeline data", () => {
    // the space AND the project's team: canSeeProject over the person's work scope
    const scope = page.indexOf("canSeeProject(scope, project)");
    const data = page.indexOf("await getProjectTimeline");
    const resolve = page.indexOf("workspaceId: true, teamId: true");
    expect(scope).toBeGreaterThan(-1);
    expect(resolve).toBeGreaterThan(-1);
    expect(resolve).toBeLessThan(data);
    expect(scope).toBeLessThan(data);
  });
});

describe("task tenant-scope validations (P1/P2 regression)", () => {
  const tasks = read("src", "server", "services", "tasks.ts");

  it("createTask rejects assignees outside the actor's organization", () => {
    // the check lives in the one judge every assignment goes through (services/task-assign.ts, by rank)
    const judge = read("src", "server", "services", "task-assign.ts");
    expect(judge).toContain("assignee.not_member");
    expect(judge).toContain("organizationMember.findFirst");
    // and createTask asks it, guarded by the assignee being set
    const createBody = tasks.slice(tasks.indexOf("createTask"), tasks.indexOf("moveTask"));
    expect(createBody).toContain("if (assigneeId)");
    expect(createBody).toContain("judgeAssignment(tx, actor, assigneeId");
  });

  it("updateTask validates milestones belong to the task's project", () => {
    const updateBody = tasks.slice(tasks.indexOf("updateTask"), tasks.indexOf("deleteTask"));
    expect(updateBody).toContain("milestone.invalid");
    expect(updateBody).toContain("before.projectId");
  });

  it("assertTaskScope selects projectId (needed for milestone scoping)", () => {
    const scopeBody = tasks.slice(tasks.indexOf("interface ScopedTask"), tasks.indexOf("export async function createTask"));
    expect(scopeBody).toContain("projectId: true");
  });
});
