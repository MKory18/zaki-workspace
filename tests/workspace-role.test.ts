import { describe, expect, it } from "vitest";
import { canWriteInWorkspace, workspaceRoleOf } from "@/server/workspace-role";

type Row = "ADMIN" | "MEMBER" | "GUEST" | null;

/**
 * `canWriteInWorkspace` is the pages' copy of what `requireWorkspace(id, ["ADMIN", "MEMBER"])` says
 * on the server (List, Calendar, My Work and the board page use it to show or hide edit controls).
 * The two must never disagree, so this table is the one written statement of the rule; the database
 * suite (tests/db/guest-workspaces.test.ts) feeds the same table to the real guard.
 *
 * A space is visible only to the people IN it and to the OWNER.
 */
describe("canWriteInWorkspace: the same verdict as the server guard", () => {
  // [org role, workspace row (null = no row)] -> may create / change things there
  const table: [string, Row, boolean][] = [
    // the OWNER sees and writes every space, with or without a row of their own
    ["OWNER", null, true],
    ["OWNER", "ADMIN", true],
    ["OWNER", "MEMBER", true],
    ["OWNER", "GUEST", true],
    // an ADMIN is like everybody else until they are put in a space; once in, they outrank a lower row
    ["ADMIN", null, false],
    ["ADMIN", "ADMIN", true],
    ["ADMIN", "MEMBER", true],
    ["ADMIN", "GUEST", true],
    // LEAD and MEMBER: the row decides, and a GUEST row is read-only
    ["LEAD", null, false],
    ["LEAD", "ADMIN", true],
    ["LEAD", "MEMBER", true],
    ["LEAD", "GUEST", false],
    ["MEMBER", null, false],
    ["MEMBER", "ADMIN", true],
    ["MEMBER", "MEMBER", true],
    ["MEMBER", "GUEST", false],
    // an org GUEST (an external partner) never writes, whatever their row says
    ["GUEST", null, false],
    ["GUEST", "ADMIN", false],
    ["GUEST", "MEMBER", false],
    ["GUEST", "GUEST", false],
  ];

  it.each(table)("%s with workspace row %s -> may write: %s", (orgRole, row, expected) => {
    expect(canWriteInWorkspace(orgRole, row)).toBe(expected);
  });

  it("somebody with no organization role is not a member at all: never writes (fails closed)", () => {
    for (const row of ["ADMIN", "MEMBER", "GUEST", null, undefined] as const) {
      expect(canWriteInWorkspace(null, row), `null / ${row}`).toBe(false);
      expect(canWriteInWorkspace(undefined, row), `undefined / ${row}`).toBe(false);
    }
  });

  it("an organization role this code does not know never writes (fails closed)", () => {
    expect(canWriteInWorkspace("SUPERVISOR", "ADMIN")).toBe(false);
    expect(canWriteInWorkspace("", "MEMBER")).toBe(false);
  });

  it("'no row' reads the same whether it is null or undefined", () => {
    for (const role of ["OWNER", "ADMIN", "LEAD", "MEMBER", "GUEST"]) {
      expect(canWriteInWorkspace(role, undefined), role).toBe(canWriteInWorkspace(role, null));
    }
  });
});

describe("workspaceRoleOf: the role somebody has inside a space they have a row in", () => {
  it("an org GUEST is a GUEST in every space, whatever their row says", () => {
    for (const row of ["ADMIN", "MEMBER", "GUEST"] as const) expect(workspaceRoleOf("GUEST", row)).toBe("GUEST");
  });

  it("everybody else has the role of their row", () => {
    for (const org of ["OWNER", "ADMIN", "LEAD", "MEMBER"]) {
      for (const row of ["ADMIN", "MEMBER", "GUEST"] as const) expect(workspaceRoleOf(org, row), `${org}/${row}`).toBe(row);
    }
  });
});
