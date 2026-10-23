import { describe, expect, it } from "vitest";
import * as goalsRoute from "@/app/api/goals/route";
import * as goalRoute from "@/app/api/goals/[id]/route";
import * as routinesRoute from "@/app/api/production/routines/route";
import * as routineRoute from "@/app/api/production/routines/[id]/route";
import { call, db, loginAs, makeTeam, uid } from "./helpers";

/** Company A with a department; company B, whose OWNER signs in. */
async function world() {
  const a = await makeTeam();
  const b = await makeTeam();
  const foreignDept = await db.department.create({ data: { orgId: a.org.id, name: `A's secret department ${uid()}` } });
  const ownDept = await db.department.create({ data: { orgId: b.org.id, name: "B's own department" } });
  await loginAs(b.owner.id);
  return { a, b, foreignDept, ownDept };
}

const goal = (departmentId: string) => ({ title: `Goal ${uid()}`, period: "WEEKLY", anchorDate: "2026-11-02", departmentId });

describe("a department named in a goal or a routine must be the caller's own company's (review B7)", () => {
  it("goals: another company's department is not found, on create and on edit, and nothing points at it", async () => {
    const w = await world();
    const created = await call(goalsRoute.POST, { body: goal(w.foreignDept.id) });
    expect(created.status).toBe(404);
    expect(created.json?.["message"]).toBe("dept.not_found");
    expect(await db.goal.count({ where: { departmentId: w.foreignDept.id } })).toBe(0);

    const mine = await call(goalsRoute.POST, { body: goal(w.ownDept.id) });
    expect(mine.status).toBe(201);
    const id = ((mine.json?.["goal"] as { id: string } | undefined)?.id ?? (mine.json?.["id"] as string));
    const edited = await call(goalRoute.PATCH, { method: "PATCH", params: { id }, body: { departmentId: w.foreignDept.id } });
    expect(edited.status).toBe(404);
    expect((await db.goal.findUniqueOrThrow({ where: { id } })).departmentId).toBe(w.ownDept.id);

    const list = await call(goalsRoute.GET, { url: "http://localhost/api/goals" });
    expect(list.text).not.toContain(w.foreignDept.name);
  });

  it("routines: another company's department is not found, on create and on edit", async () => {
    const w = await world();
    const created = await call(routinesRoute.POST, { body: { title: "Cut the fabric", departmentId: w.foreignDept.id } });
    expect(created.status).toBe(404);
    expect(await db.routine.count({ where: { departmentId: w.foreignDept.id } })).toBe(0);

    const mine = await call(routinesRoute.POST, { body: { title: "Cut the fabric", departmentId: w.ownDept.id } });
    expect(mine.status).toBe(201);
    const id = (mine.json?.["routine"] as { id: string }).id;
    const edited = await call(routineRoute.PATCH, { method: "PATCH", params: { id }, body: { title: "Cut the fabric", departmentId: w.foreignDept.id } });
    expect(edited.status).toBe(404);
    expect((await db.routine.findUniqueOrThrow({ where: { id } })).departmentId).toBe(w.ownDept.id);
  });
});
