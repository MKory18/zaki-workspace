import { describe, expect, it } from "vitest";
import * as productionRoute from "@/app/api/production/route";
import * as checklistRoute from "@/app/api/production/checklist/route";
import * as routinesRoute from "@/app/api/production/routines/route";
import * as routineRoute from "@/app/api/production/routines/[id]/route";
import { call, db, loginAs, makeTeam } from "./helpers";
import { makeRoutine, makeRoutineLog } from "./guest-helpers";

const DAY = "2026-11-02";

/** One org with one routine that runs every day, assigned to the member. */
async function productionWorld() {
  const team = await makeTeam();
  const routine = await makeRoutine({ orgId: team.org.id, title: "Cut the fabric", assigneeId: team.member.id });
  return { ...team, routine };
}

const tick = (routineId: string, done: boolean) =>
  call(checklistRoute.POST, { body: { routineId, day: DAY, done } });

describe("production: a GUEST is read-only", () => {
  it("cannot tick a routine off, nor untick one that was ticked", async () => {
    const w = await productionWorld();
    const ticked = await makeRoutine({ orgId: w.org.id, title: "Pack the boxes" });
    await makeRoutineLog(ticked.id, DAY, w.member.id);

    await loginAs(w.guest.id);
    const res = await tick(w.routine.id, true);
    expect(res.status).toBe(403);
    expect(res.json?.["message"]).toBe("guest.readonly");
    expect(await db.routineLog.count({ where: { routineId: w.routine.id } })).toBe(0);

    const untick = await tick(ticked.id, false);
    expect(untick.status).toBe(403);
    expect(untick.json?.["message"]).toBe("guest.readonly");
    const log = await db.routineLog.findFirst({ where: { routineId: ticked.id, day: DAY } });
    expect(log?.completedById).toBe(w.member.id);
  });

  it("cannot create, edit or delete a routine, and is told it is read-only", async () => {
    const w = await productionWorld();
    await loginAs(w.guest.id);

    const create = await call(routinesRoute.POST, { body: { title: "Planted routine" } });
    expect(create.status).toBe(403);
    expect(create.json?.["message"]).toBe("guest.readonly");
    expect(await db.routine.count({ where: { orgId: w.org.id } })).toBe(1);

    const edit = await call(routineRoute.PATCH, {
      method: "PATCH",
      params: { id: w.routine.id },
      body: { title: "Renamed by the guest", active: false },
    });
    expect(edit.status).toBe(403);
    expect(edit.json?.["message"]).toBe("guest.readonly");

    const del = await call(routineRoute.DELETE, { method: "DELETE", params: { id: w.routine.id } });
    expect(del.status).toBe(403);
    expect(del.json?.["message"]).toBe("guest.readonly");

    const row = await db.routine.findUniqueOrThrow({ where: { id: w.routine.id } });
    expect(row.title).toBe("Cut the fabric");
    expect(row.active).toBe(true);
  });

  it("can still read the daily checklist and the routine list", async () => {
    const w = await productionWorld();
    await makeRoutineLog(w.routine.id, DAY, w.member.id);
    await loginAs(w.guest.id);

    const day = await call(productionRoute.GET, { url: `http://localhost/api/production?day=${DAY}` });
    expect(day.status).toBe(200);
    const items = day.json?.["items"] as { title: string; doneAt: string | null }[];
    expect(items.map((i) => i.title)).toEqual(["Cut the fabric"]);
    expect(items[0]?.doneAt).not.toBeNull();

    const list = await call(routinesRoute.GET);
    expect(list.status).toBe(200);
    expect((list.json?.["routines"] as { title: string }[]).map((r) => r.title)).toEqual(["Cut the fabric"]);
  });
});

describe("production: everyone else keeps what they had", () => {
  it("a MEMBER can tick and untick, but still cannot manage routines", async () => {
    const w = await productionWorld();
    await loginAs(w.member.id);

    expect((await tick(w.routine.id, true)).status).toBe(200);
    const log = await db.routineLog.findFirst({ where: { routineId: w.routine.id, day: DAY } });
    expect(log?.completedById).toBe(w.member.id);
    expect((await tick(w.routine.id, false)).status).toBe(200);
    expect(await db.routineLog.count({ where: { routineId: w.routine.id } })).toBe(0);

    const create = await call(routinesRoute.POST, { body: { title: "Member routine" } });
    expect(create.status).toBe(403);
    expect(create.json?.["message"]).toBe("production.routines_role_denied");
    const edit = await call(routineRoute.PATCH, {
      method: "PATCH",
      params: { id: w.routine.id },
      body: { title: "Member rename" },
    });
    expect(edit.status).toBe(403);
    expect(edit.json?.["message"]).toBe("production.routines_role_denied");
    expect((await call(routineRoute.DELETE, { method: "DELETE", params: { id: w.routine.id } })).status).toBe(403);
    expect(await db.routine.count({ where: { orgId: w.org.id } })).toBe(1);
  });

  for (const role of ["admin", "owner"] as const) {
    it(`${role.toUpperCase()} can tick, create, edit and delete routines`, async () => {
      const w = await productionWorld();
      await loginAs(w[role].id);

      expect((await tick(w.routine.id, true)).status).toBe(200);

      const created = await call(routinesRoute.POST, { body: { title: "Evening clean-up", weekdays: [1, 3] } });
      expect(created.status).toBe(201);
      const id = (created.json?.["routine"] as { id: string }).id;

      const edited = await call(routineRoute.PATCH, {
        method: "PATCH",
        params: { id },
        body: { title: "Evening clean-up (long)" },
      });
      expect(edited.status).toBe(200);
      expect((await db.routine.findUniqueOrThrow({ where: { id } })).title).toBe("Evening clean-up (long)");

      expect((await call(routineRoute.DELETE, { method: "DELETE", params: { id } })).status).toBe(200);
      expect(await db.routine.findUnique({ where: { id } })).toBeNull();
    });
  }
});
