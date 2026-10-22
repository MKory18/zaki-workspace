import { describe, expect, it } from "vitest";
import { MY_WORK_TABS, getMyWork, type MyWorkData } from "@/server/services/my-work";
import { db, makeUser } from "./helpers";
import {
  addTask,
  daysFromNow,
  joinOrg,
  joinWorkspace,
  makeScopedOrg,
  seedWork,
  todayNoon,
} from "./scoping-helpers";

const idsOf = (rows: MyWorkData[keyof MyWorkData]) => rows.map((r) => r.task.id);

/** Tabs whose rows must all be assigned to the user (everything except "created"). */
const ASSIGNED_TABS = ["today", "upcoming", "overdue", "completed", "mine"] as const;

describe("My Work: only the caller's own tasks, only in workspaces they can access", () => {
  it("returns every tab, empty, for someone who belongs to no organization", async () => {
    const stranger = await makeUser();
    const data = await getMyWork(stranger.id);
    expect(Object.keys(data).sort()).toEqual([...MY_WORK_TABS].sort());
    for (const tab of MY_WORK_TABS) expect(data[tab]).toEqual([]);
  });

  it("puts each of my assigned tasks in the right tab and never shows someone else's task", async () => {
    const f = await makeScopedOrg();
    const me = f.member;
    const colleague = f.admin;
    const { token } = f;
    const mk = (label: string, extra: Partial<Parameters<typeof seedWork>[0]> = {}) =>
      seedWork({ orgId: f.org.id, workspaceId: f.wsIn.id, token, label, creatorId: colleague.id, ...extra });

    const today = await mk("today", { assigneeId: me.id, dueDate: todayNoon() });
    const upcoming = await mk("upcoming", { assigneeId: me.id, dueDate: daysFromNow(3) });
    const overdue = await mk("overdue", { assigneeId: me.id, dueDate: daysFromNow(-3) });
    const done = await mk("done", { assigneeId: me.id, completedAt: daysFromNow(-0.1) });
    const undated = await mk("undated", { assigneeId: me.id });

    // work that belongs to a colleague, in the very workspace I am in
    const theirToday = await mk("their-today", { assigneeId: colleague.id, dueDate: todayNoon() });
    const theirOverdue = await mk("their-overdue", { assigneeId: colleague.id, dueDate: daysFromNow(-5) });
    const theirDone = await mk("their-done", { assigneeId: colleague.id, completedAt: daysFromNow(-1) });
    const unassigned = await mk("unassigned", { dueDate: todayNoon() });
    const theirs = [theirToday, theirOverdue, theirDone, unassigned].map((w) => w.task.id);

    const data = await getMyWork(me.id);

    expect(idsOf(data.today)).toContain(today.task.id);
    expect(idsOf(data.upcoming)).toContain(upcoming.task.id);
    expect(idsOf(data.overdue)).toContain(overdue.task.id);
    expect(idsOf(data.completed)).toContain(done.task.id);
    expect(idsOf(data.mine)).toEqual(
      expect.arrayContaining([today.task.id, upcoming.task.id, overdue.task.id, undated.task.id]),
    );
    // the tabs keep their meaning
    expect(idsOf(data.today)).not.toContain(upcoming.task.id);
    expect(idsOf(data.upcoming)).not.toContain(today.task.id);
    expect(idsOf(data.overdue)).not.toContain(upcoming.task.id);
    expect(idsOf(data.completed)).not.toContain(today.task.id);
    expect(idsOf(data.mine)).not.toContain(done.task.id);

    // never anybody else's task, in any tab
    for (const tab of MY_WORK_TABS) {
      for (const id of theirs) expect(idsOf(data[tab]), `${tab} must not hold ${id}`).not.toContain(id);
    }
    for (const tab of ASSIGNED_TABS) {
      for (const row of data[tab]) expect(row.task.assigneeId, `${tab} row ${row.task.key}`).toBe(me.id);
    }
  });

  it("the 'created' tab holds the tasks I created (open ones), whoever they are assigned to, and nobody else's", async () => {
    const f = await makeScopedOrg();
    const me = f.member;
    const mk = (label: string, creatorId: string, extra: Partial<Parameters<typeof seedWork>[0]> = {}) =>
      seedWork({ orgId: f.org.id, workspaceId: f.wsIn.id, token: f.token, label, creatorId, ...extra });

    const mineForAdmin = await mk("created-for-admin", me.id, { assigneeId: f.admin.id });
    const mineUnassigned = await mk("created-unassigned", me.id);
    const mineDone = await mk("created-done", me.id, { completedAt: daysFromNow(-1) });
    const byAdmin = await mk("created-by-admin", f.admin.id, { assigneeId: me.id });

    const data = await getMyWork(me.id);
    expect(idsOf(data.created)).toEqual(expect.arrayContaining([mineForAdmin.task.id, mineUnassigned.task.id]));
    expect(idsOf(data.created)).not.toContain(mineDone.task.id); // open only, as before
    expect(idsOf(data.created)).not.toContain(byAdmin.task.id);
    for (const row of data.created) expect(row.task.creatorId).toBe(me.id);
    // the assigned-to-me task shows in "mine", not in "created"
    expect(idsOf(data.mine)).toContain(byAdmin.task.id);
  });

  it("hides work in a workspace I cannot access, assigned or created, in every tab", async () => {
    const f = await makeScopedOrg();
    const me = f.member;
    const hidden = (label: string, extra: Partial<Parameters<typeof seedWork>[0]> = {}) =>
      seedWork({ orgId: f.org.id, workspaceId: f.wsOut.id, token: f.token, label, creatorId: f.owner.id, ...extra });

    const h1 = await hidden("h-today", { assigneeId: me.id, dueDate: todayNoon() });
    const h2 = await hidden("h-upcoming", { assigneeId: me.id, dueDate: daysFromNow(4) });
    const h3 = await hidden("h-overdue", { assigneeId: me.id, dueDate: daysFromNow(-4) });
    const h4 = await hidden("h-done", { assigneeId: me.id, completedAt: daysFromNow(-1) });
    const h5 = await hidden("h-created", { creatorId: me.id, assigneeId: f.owner.id });
    const hiddenIds = [h1, h2, h3, h4, h5].map((w) => w.task.id);

    const data = await getMyWork(me.id);
    for (const tab of MY_WORK_TABS) {
      for (const id of hiddenIds) expect(idsOf(data[tab]), `${tab} must not hold ${id}`).not.toContain(id);
    }

    // being put into that workspace makes exactly that work appear
    await joinWorkspace(me.id, f.wsOut.id);
    const after = await getMyWork(me.id);
    expect(idsOf(after.today)).toContain(h1.task.id);
    expect(idsOf(after.upcoming)).toContain(h2.task.id);
    expect(idsOf(after.overdue)).toContain(h3.task.id);
    expect(idsOf(after.completed)).toContain(h4.task.id);
    expect(idsOf(after.created)).toContain(h5.task.id);
  });

  it("the OWNER inherits every workspace of the org (no row needed, editable) but still sees only their own tasks", async () => {
    const f = await makeScopedOrg();
    const owner = f.owner;
    const mineOut = await seedWork({
      orgId: f.org.id,
      workspaceId: f.wsOut.id,
      token: f.token,
      label: "owner-mine",
      creatorId: f.admin.id,
      assigneeId: owner.id,
      dueDate: todayNoon(),
    });
    const othersOut = await seedWork({
      orgId: f.org.id,
      workspaceId: f.wsOut.id,
      token: f.token,
      label: "others",
      creatorId: f.admin.id,
      assigneeId: f.member.id,
      dueDate: todayNoon(),
    });

    const data = await getMyWork(owner.id);
    expect(idsOf(data.mine)).toContain(mineOut.task.id); // wsOut, which the owner sees without a row
    expect(idsOf(data.today)).toContain(mineOut.task.id);
    for (const tab of MY_WORK_TABS) expect(idsOf(data[tab])).not.toContain(othersOut.task.id);
    expect(data.mine.find((r) => r.task.id === mineOut.task.id)!.editable).toBe(true);
    expect(await db.workspaceMember.count({ where: { userId: owner.id } })).toBe(0);
  });

  it("an ADMIN sees their own tasks only in the spaces they are in: the rest stays hidden until they are put in", async () => {
    const f = await makeScopedOrg();
    const admin = f.admin;
    const mk = (workspaceId: string, label: string) =>
      seedWork({
        orgId: f.org.id,
        workspaceId,
        token: f.token,
        label,
        creatorId: f.owner.id,
        assigneeId: admin.id,
        dueDate: todayNoon(),
      });
    const inWsIn = await mk(f.wsIn.id, "admin-in");
    const inWsOut = await mk(f.wsOut.id, "admin-out");

    // no row anywhere: an ADMIN's rank opens nothing, even work assigned to them
    const none = await getMyWork(admin.id);
    for (const tab of MY_WORK_TABS) {
      expect(idsOf(none[tab]), tab).not.toContain(inWsIn.task.id);
      expect(idsOf(none[tab]), tab).not.toContain(inWsOut.task.id);
    }

    await joinWorkspace(admin.id, f.wsIn.id);
    const some = await getMyWork(admin.id);
    expect(idsOf(some.mine)).toContain(inWsIn.task.id);
    expect(idsOf(some.mine)).not.toContain(inWsOut.task.id);
    // an ADMIN who is in the space writes there even with a plain MEMBER row
    expect(some.mine.find((r) => r.task.id === inWsIn.task.id)!.editable).toBe(true);

    await joinWorkspace(admin.id, f.wsOut.id);
    expect(idsOf((await getMyWork(admin.id)).mine)).toEqual(expect.arrayContaining([inWsIn.task.id, inWsOut.task.id]));
  });

  it("GUESTs keep read-only rows; members get editable rows", async () => {
    const f = await makeScopedOrg();
    await joinWorkspace(f.guest.id, f.wsIn.id, "GUEST");
    const forGuest = await seedWork({
      orgId: f.org.id,
      workspaceId: f.wsIn.id,
      token: f.token,
      label: "for-guest",
      creatorId: f.owner.id,
      assigneeId: f.guest.id,
    });
    const forMember = await seedWork({
      orgId: f.org.id,
      workspaceId: f.wsIn.id,
      token: f.token,
      label: "for-member",
      creatorId: f.owner.id,
      assigneeId: f.member.id,
    });

    const guestRows = (await getMyWork(f.guest.id)).mine;
    expect(idsOf(guestRows)).toEqual([forGuest.task.id]);
    expect(guestRows.every((r) => r.editable === false)).toBe(true);

    const memberRows = (await getMyWork(f.member.id)).mine;
    expect(idsOf(memberRows)).toContain(forMember.task.id);
    expect(memberRows.every((r) => r.editable === true)).toBe(true);
  });

  it("covers every organization I belong to, each with its own accessible workspaces", async () => {
    const a = await makeScopedOrg();
    const b = await makeScopedOrg();
    const multi = await makeUser({ orgId: a.org.id, role: "MEMBER" });
    await joinWorkspace(multi.id, a.wsIn.id);
    await joinOrg(multi.id, b.org.id, "GUEST");
    await joinWorkspace(multi.id, b.wsOut.id, "GUEST");

    const inA = await seedWork({ orgId: a.org.id, workspaceId: a.wsIn.id, token: a.token, label: "multi-a", creatorId: a.owner.id, assigneeId: multi.id });
    const hiddenA = await seedWork({ orgId: a.org.id, workspaceId: a.wsOut.id, token: a.token, label: "multi-a-hidden", creatorId: a.owner.id, assigneeId: multi.id });
    const inB = await seedWork({ orgId: b.org.id, workspaceId: b.wsOut.id, token: b.token, label: "multi-b", creatorId: b.owner.id, assigneeId: multi.id });
    const hiddenB = await seedWork({ orgId: b.org.id, workspaceId: b.wsIn.id, token: b.token, label: "multi-b-hidden", creatorId: b.owner.id, assigneeId: multi.id });

    const rows = (await getMyWork(multi.id)).mine;
    expect(idsOf(rows).sort()).toEqual([inA.task.id, inB.task.id].sort());
    expect(idsOf(rows)).not.toContain(hiddenA.task.id);
    expect(idsOf(rows)).not.toContain(hiddenB.task.id);
    // read-only follows the org role of the task's own org
    expect(rows.find((r) => r.task.id === inA.task.id)!.editable).toBe(true);
    expect(rows.find((r) => r.task.id === inB.task.id)!.editable).toBe(false);
  });

  it("does not return archived tasks", async () => {
    const f = await makeScopedOrg();
    const w = await seedWork({
      orgId: f.org.id,
      workspaceId: f.wsIn.id,
      token: f.token,
      label: "to-archive",
      creatorId: f.owner.id,
      assigneeId: f.member.id,
    });
    const kept = await addTask(w, {
      orgId: f.org.id,
      workspaceId: f.wsIn.id,
      token: f.token,
      creatorId: f.owner.id,
      assigneeId: f.member.id,
      title: `${f.token} kept`,
    });
    await db.task.update({ where: { id: w.task.id }, data: { archived: true } });
    const rows = (await getMyWork(f.member.id)).mine;
    expect(idsOf(rows)).toContain(kept.id);
    expect(idsOf(rows)).not.toContain(w.task.id);
  });
});
