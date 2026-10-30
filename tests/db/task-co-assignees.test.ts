import { afterEach, describe, expect, it } from "vitest";
import * as instantTaskRoute from "@/app/api/instant/task/route";
import * as tasksRoute from "@/app/api/tasks/route";
import * as taskRoute from "@/app/api/tasks/[id]/route";
import * as membersRoute from "@/app/api/organizations/[id]/members/route";
import { SPACE_COOKIE } from "@/server/services/current-space";
import { accountsApi } from "./accounts-helpers";
import { call, db, loginAs, makeTeam, makeUser, makeWorkspace } from "./helpers";

/**
 * «لمين» with more than one person on «مهمة فورية» (the owner's ask, 2026-10-30).
 *
 * One task, several people: the first picked stays the task's own assignee (`Task.assigneeId`) so every old
 * read, counter and notification keeps working, and the others ride beside them (`TaskCoAssignee`). The task
 * is then theirs in the same way — each of them finds it, and the roster counts it for each of them.
 */
const jar = () => (globalThis as { __zkCookieJar?: Map<string, string> }).__zkCookieJar as Map<string, string>;
afterEach(() => jar().delete(SPACE_COOKIE));

async function world() {
  const t = await makeTeam();
  const second = await makeUser({ orgId: t.org.id, role: "MEMBER", name: "Second" });
  const outsider = await makeUser({ orgId: t.org.id, role: "MEMBER", name: "Outsider" });
  const ws = await makeWorkspace(t.org.id, [
    { userId: t.admin.id, role: "ADMIN" },
    { userId: t.member.id },
    { userId: second.id },
  ]);
  jar().set(SPACE_COOKIE, ws.id);
  return { ...t, ws, second, outsider };
}

const sendTask = (body: unknown) => call(instantTaskRoute.POST, { body });
const taskIdOf = (res: { json: Record<string, unknown> | null }) => (res.json?.["task"] as { id: string }).id;
/** The tasks of one person, through the real list door (the same filter «مهامي» reads). */
const seenBy = async (workspaceId: string, userId: string) => {
  const res = await call(tasksRoute.GET, { url: `http://localhost/api/tasks?workspaceId=${workspaceId}&assigneeId=${userId}` });
  return (res.json?.["tasks"] as { id: string; assigneeId: string | null; coAssignees: { userId: string }[] }[]) ?? [];
};
const coIdsOf = async (taskId: string) =>
  (await db.taskCoAssignee.findMany({ where: { taskId }, select: { userId: true }, orderBy: { createdAt: "asc" } })).map((r) => r.userId);

describe("«مهمة فورية» لأكثر من شخص", () => {
  it("the first person picked leads it, the others ride beside them, and each one finds it", async () => {
    const w = await world();
    await loginAs(w.admin.id);
    const res = await sendTask({ title: "Pack the order", assigneeIds: [w.member.id, w.second.id], priority: "HIGH" });
    expect(res.status).toBe(201);
    const id = taskIdOf(res);

    const task = await db.task.findUniqueOrThrow({ where: { id } });
    expect(task.assigneeId).toBe(w.member.id);
    expect(await coIdsOf(id)).toEqual([w.second.id]);
    // both are told, the creator is not
    expect(await db.notification.count({ where: { userId: w.member.id, type: "task_assigned" } })).toBe(1);
    expect(await db.notification.count({ where: { userId: w.second.id, type: "task_assigned" } })).toBe(1);
    expect(await db.notification.count({ where: { userId: w.admin.id } })).toBe(0);

    // the same task, in each of their lists, with the whole list of people on it
    for (const userId of [w.member.id, w.second.id]) {
      await loginAs(userId);
      const mine = await seenBy(w.ws.id, userId);
      expect(mine.map((t) => t.id)).toEqual([id]);
      expect(mine[0]!.assigneeId).toBe(w.member.id);
      expect(mine[0]!.coAssignees.map((r) => r.userId)).toEqual([w.second.id]);
    }
    // …and the roster counts it as open work for both of them
    await loginAs(w.owner.id);
    const roster = (await call(membersRoute.GET, { params: { id: w.org.id } })).json?.["members"] as { id: string; openWork: number }[];
    expect(roster.find((m) => m.id === w.member.id)?.openWork).toBe(1);
    expect(roster.find((m) => m.id === w.second.id)?.openWork).toBe(1);
  });

  it("one name alone is still exactly one person, as before", async () => {
    const w = await world();
    await loginAs(w.admin.id);
    const id = taskIdOf(await sendTask({ title: "One person only", assigneeIds: [w.member.id] }));
    expect((await db.task.findUniqueOrThrow({ where: { id } })).assigneeId).toBe(w.member.id);
    expect(await coIdsOf(id)).toEqual([]);
    expect(await db.notification.count({ where: { userId: w.second.id } })).toBe(0);
  });

  it("never to somebody outside the space: nothing is made and nobody is told", async () => {
    const w = await world();
    await loginAs(w.admin.id);
    const res = await sendTask({ title: "Lost", assigneeIds: [w.member.id, w.outsider.id] });
    expect(res.status).toBe(403);
    expect(res.json?.["message"]).toBe("instant.not_in_space");
    expect(await db.task.count({ where: { workspaceId: w.ws.id } })).toBe(0);
    expect(await db.notification.count({ where: { userId: w.member.id } })).toBe(0);
  });

  it("a task made with no people is refused, and names twice are one person", async () => {
    const w = await world();
    await loginAs(w.admin.id);
    expect((await sendTask({ title: "Nobody" })).status).toBe(422);
    expect((await sendTask({ title: "Nobody", assigneeIds: [] })).status).toBe(422);

    const id = taskIdOf(await sendTask({ title: "Twice", assigneeIds: [w.member.id, w.member.id, w.second.id] }));
    expect(await coIdsOf(id)).toEqual([w.second.id]);
    expect(await db.notification.count({ where: { userId: w.second.id } })).toBe(1);
  });
});

describe("changing the people of an existing task", () => {
  it("the whole list is replaced, the new person is told once, and the old one is gone", async () => {
    const w = await world();
    await loginAs(w.admin.id);
    const id = taskIdOf(await sendTask({ title: "Repaint the shop", assigneeIds: [w.member.id] }));

    // the person holding it may change it (a member, in their own space)
    await loginAs(w.member.id);
    const res = await call(taskRoute.PATCH, {
      method: "PATCH",
      params: { id },
      body: { assigneeIds: [w.second.id, w.member.id] },
    });
    expect(res.status).toBe(200);
    expect((await db.task.findUniqueOrThrow({ where: { id } })).assigneeId).toBe(w.second.id);
    expect(await coIdsOf(id)).toEqual([w.member.id]);
    expect(await db.notification.count({ where: { userId: w.second.id, type: "task_assigned" } })).toBe(1);

    // sending the same list again tells nobody a second time
    await call(taskRoute.PATCH, { method: "PATCH", params: { id }, body: { assigneeIds: [w.second.id, w.member.id] } });
    expect(await db.notification.count({ where: { userId: w.second.id, type: "task_assigned" } })).toBe(1);

    // back to nobody, then to one person
    await call(taskRoute.PATCH, { method: "PATCH", params: { id }, body: { assigneeIds: [] } });
    const empty = await db.task.findUniqueOrThrow({ where: { id } });
    expect(empty.assigneeId).toBeNull();
    expect(await coIdsOf(id)).toEqual([]);
  });

  it("never to a suspended person, and an id already on the task is not re-checked", async () => {
    const w = await world();
    await loginAs(w.admin.id);
    const id = taskIdOf(await sendTask({ title: "Check the stock", assigneeIds: [w.member.id, w.second.id] }));
    const quitter = await makeUser({ orgId: w.org.id, role: "MEMBER", name: "Suspended" });
    await accountsApi.status(w.org.id, quitter.id, { action: "suspend" });
    await accountsApi.status(w.org.id, w.second.id, { action: "suspend" });

    // the suspended person keeps what they already had (sending the same list changes nothing for them),
    // but a NEW name that is not ACTIVE is refused and the list stays as it was
    expect((await call(taskRoute.PATCH, { method: "PATCH", params: { id }, body: { assigneeIds: [w.member.id, w.second.id] } })).status).toBe(200);
    const res = await call(taskRoute.PATCH, { method: "PATCH", params: { id }, body: { assigneeIds: [w.member.id, w.second.id, quitter.id] } });
    expect(res.status).toBe(403);
    expect(res.json?.["message"]).toBe("assignee.not_active");
    expect(await coIdsOf(id)).toEqual([w.second.id]);
  });

  it("deleting the task takes its rows with it", async () => {
    const w = await world();
    await loginAs(w.admin.id);
    const id = taskIdOf(await sendTask({ title: "Short lived", assigneeIds: [w.member.id, w.second.id] }));
    expect((await call(taskRoute.DELETE, { method: "DELETE", params: { id } })).status).toBe(200);
    expect(await db.taskCoAssignee.count({ where: { taskId: id } })).toBe(0);
  });
});

describe("when people leave", () => {
  it("offboarding: the leaver leads nothing, keeps no row, and shared work stays with the other person", async () => {
    const w = await world();
    await loginAs(w.admin.id);
    const led = taskIdOf(await sendTask({ title: "Led by the leaver", assigneeIds: [w.member.id, w.second.id] }));
    // a task the leaver holds beside somebody else who leads it
    const shared = taskIdOf(await sendTask({ title: "Led by another", assigneeIds: [w.second.id, w.member.id] }));

    await loginAs(w.owner.id);
    const res = await accountsApi.status(w.org.id, w.member.id, { action: "offboard", transferToUserId: w.admin.id });
    expect(res.status).toBe(200);

    // the task the leaver led is now the receiver's, and the second person is still on it
    const after = await db.task.findUniqueOrThrow({ where: { id: led } });
    expect(after.assigneeId).toBe(w.admin.id);
    expect(await coIdsOf(led)).toEqual([w.second.id]);
    // the task somebody else leads keeps its lead, and the leaver is named no more
    const other = await db.task.findUniqueOrThrow({ where: { id: shared } });
    expect(other.assigneeId).toBe(w.second.id);
    expect(await coIdsOf(shared)).toEqual([]);
  });
});
