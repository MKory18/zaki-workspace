import { afterEach, describe, expect, it } from "vitest";
import * as taskIdRoute from "@/app/api/tasks/[id]/route";
import * as acceptRoute from "@/app/api/tasks/[id]/request/accept/route";
import * as returnRoute from "@/app/api/tasks/[id]/request/return/route";
import * as instantTaskRoute from "@/app/api/instant/task/route";
import { SPACE_COOKIE } from "@/server/services/current-space";
import { createTask, updateTask } from "@/server/services/tasks";
import { createInstantTask } from "@/server/services/instant-work";
import { answerAssignRequest, pendingRequestsOf } from "@/server/services/task-assign";
import { call, db, loginAs, makeProject, makeTask, makeTeam, makeUser, makeWorkspace } from "./helpers";
import { ctxOf, suspend } from "./active-helpers";

/**
 * «لمين» with more than one person AND the rank rule (the owner's decisions of 2026-10-30, adopted together).
 *
 * Every person put on a task beside the first goes through the SAME judge as the first (`judgeAssignment`):
 *   - the same rank or lower (and the owner giving to anybody): added at once, beside the first;
 *   - somebody of a HIGHER rank: NOT added, a request of their own waits for them (one pending per person per task);
 *   - the partner (GUEST) and the suspended person are refused exactly as for the first person;
 *   - one higher person never refuses the whole pick: the others are still added;
 *   - when the FIRST person is above the giver, the task is born without a main assignee (a request) and the others
 *     still follow their own rule.
 * Accepting a request made for a person beside the first adds them beside the first; returning it leaves the task as it was.
 */
const jar = () => (globalThis as { __zkCookieJar?: Map<string, string> }).__zkCookieJar as Map<string, string>;
afterEach(() => jar().delete(SPACE_COOKIE));

async function world() {
  const t = await makeTeam();
  const org = t.org.id;
  const admin2 = await makeUser({ orgId: org, role: "ADMIN", name: "Admin Two" });
  const lead = await makeUser({ orgId: org, role: "LEAD", name: "Lead" });
  const member2 = await makeUser({ orgId: org, role: "MEMBER", name: "Member Two" });
  const member3 = await makeUser({ orgId: org, role: "MEMBER", name: "Member Three" });
  const guest2 = await makeUser({ orgId: org, role: "GUEST", name: "Guest Two" });
  const outsiderGuest = await makeUser({ orgId: org, role: "GUEST", name: "Guest Outside" });
  const ws = await makeWorkspace(org, [
    { userId: t.admin.id, role: "ADMIN" },
    { userId: admin2.id, role: "ADMIN" },
    { userId: lead.id },
    { userId: t.member.id },
    { userId: member2.id },
    { userId: member3.id },
    { userId: t.guest.id, role: "GUEST" },
    { userId: guest2.id, role: "GUEST" },
  ]);
  const made = await makeProject(ws.id);
  const input = (assigneeId: string | null, coAssigneeIds: string[], title = "Shared work") => ({
    workspaceId: ws.id,
    projectId: made.project.id,
    boardId: made.board.id,
    title,
    assigneeId,
    coAssigneeIds,
  });
  const as = (u: { id: string }) => ({ userId: u.id, orgId: org });
  const existing = (assigneeId: string | null = null) =>
    makeTask({ orgId: org, workspaceId: ws.id, projectId: made.project.id, boardId: made.board.id, columnId: made.todo.id, creatorId: t.owner.id, assigneeId });
  jar().set(SPACE_COOKIE, ws.id);
  return { ...t, admin2, lead, member2, member3, guest2, outsiderGuest, ws, ...made, input, as, existing };
}

const bells = (userId: string, type: string) => db.notification.findMany({ where: { userId, type } });
const requests = (taskId: string) => db.taskAssignRequest.findMany({ where: { taskId }, orderBy: { createdAt: "asc" } });
const coIdsOf = async (taskId: string) =>
  (await db.taskCoAssignee.findMany({ where: { taskId }, select: { userId: true } })).map((r) => r.userId).sort();
const sorted = (...ids: string[]) => [...ids].sort();

describe("creating a task for several people: each one by rank", () => {
  it("the same rank or lower beside the first: added at once, no request", async () => {
    const w = await world();
    // a lead gives to a member (first), a member of the same rank as another, and a partner of the space
    const task = await createTask(w.as(w.lead), w.input(w.member.id, [w.member2.id, w.guest.id, w.lead.id]));
    expect(task.assigneeId).toBe(w.member.id);
    expect(await coIdsOf(task.id)).toEqual(sorted(w.member2.id, w.guest.id, w.lead.id));
    expect(task.assignRequest).toBeNull();
    expect(task.coRequests).toEqual([]);
    expect(await db.taskAssignRequest.count({ where: { orgId: w.org.id } })).toBe(0);
  });

  it("somebody ABOVE beside the first is asked, not added; the others are still added", async () => {
    const w = await world();
    const task = await createTask(w.as(w.lead), w.input(w.member.id, [w.admin.id, w.member2.id, w.owner.id]));
    expect(task.assigneeId).toBe(w.member.id);
    // only the people the task really went to are on it
    expect(await coIdsOf(task.id)).toEqual([w.member2.id]);
    expect(task.assignRequest).toBeNull();
    expect(task.coRequests.map((r) => r.toUserId).sort()).toEqual(sorted(w.admin.id, w.owner.id));
    const rows = await requests(task.id);
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row).toMatchObject({ fromUserId: w.lead.id, status: "PENDING", asCo: true });
    // each higher person is told by the request, not by «أُسندت إليك»
    for (const higher of [w.admin, w.owner]) {
      expect(await bells(higher.id, "task_assign_request")).toHaveLength(1);
      expect(await bells(higher.id, "task_assigned")).toEqual([]);
    }
    const history = await db.taskActivity.findMany({ where: { taskId: task.id, event: "task.assign_requested" } });
    expect(history).toHaveLength(2);
  });

  it("when the FIRST person is above the giver, it is a request and the others still follow their own rule", async () => {
    const w = await world();
    const task = await createTask(w.as(w.lead), w.input(w.admin.id, [w.member.id, w.admin2.id, w.member2.id]));
    expect(task.assigneeId).toBeNull();
    expect(task.assignRequest).toMatchObject({ toUserId: w.admin.id });
    expect(await coIdsOf(task.id)).toEqual(sorted(w.member.id, w.member2.id));
    expect(task.coRequests.map((r) => r.toUserId)).toEqual([w.admin2.id]);
    const rows = await requests(task.id);
    expect(rows.find((r) => r.toUserId === w.admin.id)).toMatchObject({ asCo: false, status: "PENDING" });
    expect(rows.find((r) => r.toUserId === w.admin2.id)).toMatchObject({ asCo: true, status: "PENDING" });
  });

  it("the OWNER gives to everybody directly, higher people included", async () => {
    const w = await world();
    const task = await createTask(w.as(w.owner), w.input(w.admin.id, [w.lead.id, w.member.id, w.admin2.id]));
    expect(task.assigneeId).toBe(w.admin.id);
    expect(await coIdsOf(task.id)).toEqual(sorted(w.lead.id, w.member.id, w.admin2.id));
    expect(await db.taskAssignRequest.count({ where: { orgId: w.org.id } })).toBe(0);
  });

  it("a member asks every higher person beside a same-rank first person: three people, three requests, one task", async () => {
    const w = await world();
    const task = await createTask(w.as(w.member), w.input(w.member2.id, [w.lead.id, w.admin.id, w.owner.id, w.member3.id]));
    expect(task.assigneeId).toBe(w.member2.id);
    expect(await coIdsOf(task.id)).toEqual([w.member3.id]);
    expect((await requests(task.id)).map((r) => r.toUserId).sort()).toEqual(sorted(w.lead.id, w.admin.id, w.owner.id));
  });

  it("the partner: a space partner beside the first is direct (the lowest rank); one outside the space refuses the pick, nothing is made", async () => {
    const w = await world();
    const ok = await createTask(w.as(w.member), w.input(w.member2.id, [w.guest2.id]));
    expect(await coIdsOf(ok.id)).toEqual([w.guest2.id]);
    const before = await db.task.count({ where: { orgId: w.org.id } });
    await expect(createTask(w.as(w.member), w.input(w.member2.id, [w.member3.id, w.outsiderGuest.id]))).rejects.toMatchObject({
      message: "assign.guest_outside_space",
    });
    expect(await db.task.count({ where: { orgId: w.org.id } })).toBe(before);
  });

  it("a partner giving upward is refused outright (never a request), and a partner gives sideways inside the space only", async () => {
    const w = await world();
    await expect(createTask(w.as(w.guest), w.input(w.guest2.id, [w.member.id]))).rejects.toMatchObject({ message: "assign.guest_no_request" });
    expect(await db.taskAssignRequest.count({ where: { orgId: w.org.id } })).toBe(0);
    const sideways = await createTask(w.as(w.guest), w.input(w.guest2.id, [w.guest.id]));
    expect(sideways.assigneeId).toBe(w.guest2.id);
    expect(await coIdsOf(sideways.id)).toEqual([w.guest.id]);
  });

  it("a suspended person beside the first is refused (even by the owner); a person outside the company too", async () => {
    const w = await world();
    await suspend(w.org.id, w.member3.id);
    await expect(createTask(w.as(w.owner), w.input(w.member.id, [w.member3.id]))).rejects.toMatchObject({ message: "assignee.not_active" });
    const stranger = await makeUser({ orgId: (await makeTeam()).org.id, role: "MEMBER", name: "Elsewhere" });
    await expect(createTask(w.as(w.owner), w.input(w.member.id, [stranger.id]))).rejects.toMatchObject({ message: "assignee.not_member" });
    expect(await db.task.count({ where: { orgId: w.org.id } })).toBe(0);
  });

  it("a higher person who is not in the task's space cannot be asked (they could not open it): the pick is refused", async () => {
    const w = await world();
    const outsideAdmin = await makeUser({ orgId: w.org.id, role: "ADMIN", name: "Admin Not In Space" });
    await expect(createTask(w.as(w.member), w.input(w.member2.id, [outsideAdmin.id]))).rejects.toMatchObject({ message: "assign.request_not_in_space" });
    expect(await db.task.count({ where: { orgId: w.org.id } })).toBe(0);
  });
});

describe("changing the people of a task: each NEW person by rank", () => {
  it("adding people: lower ones join, a higher one is asked once (the same pick sent again changes nothing)", async () => {
    const w = await world();
    const task = await w.existing(w.member.id);
    const first = await updateTask(w.as(w.lead), task.id, { coAssigneeIds: [w.member2.id, w.admin.id] });
    expect(await coIdsOf(task.id)).toEqual([w.member2.id]);
    expect(first.coRequests.map((r) => r.toUserId)).toEqual([w.admin.id]);
    expect(await bells(w.admin.id, "task_assign_request")).toHaveLength(1);

    // the same pick again: nobody is asked twice, nothing new is stored
    const again = await updateTask(w.as(w.lead), task.id, { coAssigneeIds: [w.member2.id, w.admin.id] });
    expect(again.coRequests).toEqual([]);
    expect(await requests(task.id)).toHaveLength(1);
    expect(await bells(w.admin.id, "task_assign_request")).toHaveLength(1);
    expect(await coIdsOf(task.id)).toEqual([w.member2.id]);
  });

  it("a person who already holds the task is not judged again, whatever their rank (the first one is re-ordered, nobody asked)", async () => {
    const w = await world();
    // the owner put a lead and an admin on a task (first: the member): all of them hold it
    const task = await createTask(w.as(w.owner), w.input(w.member.id, [w.admin.id, w.lead.id]));
    // a lead re-orders the list: the admin keeps the task, nobody is asked
    const saved = await updateTask(w.as(w.lead), task.id, { assigneeId: w.admin.id, coAssigneeIds: [w.member.id, w.lead.id] });
    expect(saved.assignRequest).toBeNull();
    expect(saved.coRequests).toEqual([]);
    expect(saved.assigneeId).toBe(w.admin.id);
    expect(await coIdsOf(task.id)).toEqual(sorted(w.member.id, w.lead.id));
    expect(await db.taskAssignRequest.count({ where: { orgId: w.org.id } })).toBe(0);
  });

  it("a higher person made the FIRST while others are added: the first is asked (the task keeps who it had), the others join", async () => {
    const w = await world();
    const task = await w.existing(w.member.id);
    const saved = await updateTask(w.as(w.lead), task.id, { assigneeId: w.admin.id, coAssigneeIds: [w.member.id, w.member2.id, w.owner.id] });
    expect(saved.assignRequest).toMatchObject({ toUserId: w.admin.id });
    expect(saved.coRequests.map((r) => r.toUserId)).toEqual([w.owner.id]);
    // the task still has its old first person; the old first is not duplicated beside themself
    const after = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(after.assigneeId).toBe(w.member.id);
    expect(await coIdsOf(task.id)).toEqual([w.member2.id]);
    const rows = await requests(task.id);
    expect(rows.find((r) => r.toUserId === w.admin.id)).toMatchObject({ asCo: false });
    expect(rows.find((r) => r.toUserId === w.owner.id)).toMatchObject({ asCo: true });
  });

  it("the main kind keeps its one-at-a-time rule: a second request for the first person waits", async () => {
    const w = await world();
    const task = await w.existing();
    await updateTask(w.as(w.member), task.id, { assigneeId: w.admin.id });
    await expect(updateTask(w.as(w.member), task.id, { assigneeId: w.owner.id })).rejects.toMatchObject({ message: "taskreq.already_pending" });
    // but a person beside the first can be asked meanwhile
    const beside = await updateTask(w.as(w.member), task.id, { coAssigneeIds: [w.lead.id] });
    expect(beside.coRequests.map((r) => r.toUserId)).toEqual([w.lead.id]);
    expect((await pendingRequestsOf(task.id)).map((r) => [r.toUserId, r.asCo])).toEqual([
      [w.admin.id, false],
      [w.lead.id, true],
    ]);
  });

  it("a partner outside the space, or somebody suspended, refuses the whole change", async () => {
    const w = await world();
    const task = await w.existing(w.member.id);
    await expect(updateTask(w.as(w.admin), task.id, { coAssigneeIds: [w.member2.id, w.outsiderGuest.id] })).rejects.toMatchObject({ message: "assign.guest_outside_space" });
    await suspend(w.org.id, w.member3.id);
    await expect(updateTask(w.as(w.admin), task.id, { coAssigneeIds: [w.member3.id] })).rejects.toMatchObject({ message: "assignee.not_active" });
    expect(await coIdsOf(task.id)).toEqual([]);
  });

  it("the HTTP door: PATCH with the whole list adds the lower people, asks the higher one, and tells only those who got it", async () => {
    const w = await world();
    const task = await w.existing();
    await loginAs(w.lead.id);
    const res = await call(taskIdRoute.PATCH, { method: "PATCH", params: { id: task.id }, body: { assigneeIds: [w.member.id, w.admin.id, w.member2.id] } });
    expect(res.status).toBe(200);
    const after = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(after.assigneeId).toBe(w.member.id);
    expect(await coIdsOf(task.id)).toEqual([w.member2.id]);
    expect((await requests(task.id)).map((r) => r.toUserId)).toEqual([w.admin.id]);
    expect(await bells(w.member.id, "task_assigned")).toHaveLength(1);
    expect(await bells(w.member2.id, "task_assigned")).toHaveLength(1);
    expect(await bells(w.admin.id, "task_assigned")).toEqual([]);
    expect(await bells(w.admin.id, "task_assign_request")).toHaveLength(1);
  });
});

describe("answering a request made for a person beside the first", () => {
  async function asked() {
    const w = await world();
    const task = await createTask(w.as(w.lead), w.input(w.member.id, [w.admin.id, w.owner.id, w.member2.id], "Asked beside"));
    const rows = await requests(task.id);
    const of = (id: string) => rows.find((r) => r.toUserId === id)!;
    return { ...w, task, of };
  }

  it("ACCEPT: the person joins the task beside the first (the main assignee is untouched); the others still wait", async () => {
    const w = await asked();
    expect(await answerAssignRequest(w.as(w.admin), w.task.id, { accept: true })).toEqual({ status: "ACCEPTED" });
    const after = await db.task.findUniqueOrThrow({ where: { id: w.task.id } });
    expect(after.assigneeId).toBe(w.member.id);
    expect(await coIdsOf(w.task.id)).toEqual(sorted(w.admin.id, w.member2.id));
    expect((await db.taskAssignRequest.findUniqueOrThrow({ where: { id: w.of(w.admin.id).id } })).status).toBe("ACCEPTED");
    expect((await db.taskAssignRequest.findUniqueOrThrow({ where: { id: w.of(w.owner.id).id } })).status).toBe("PENDING");
    expect(await bells(w.lead.id, "task_assign_accepted")).toHaveLength(1);
    // answered once: a second answer is refused, and the other person can still answer theirs
    await expect(answerAssignRequest(w.as(w.admin), w.task.id, { accept: true })).rejects.toMatchObject({ message: "taskreq.not_addressee" });
    expect(await answerAssignRequest(w.as(w.owner), w.task.id, { accept: true })).toEqual({ status: "ACCEPTED" });
    expect(await coIdsOf(w.task.id)).toEqual(sorted(w.admin.id, w.owner.id, w.member2.id));
  });

  it("RETURN with a reason: the task stays as it was, the reason goes back, the other request is untouched", async () => {
    const w = await asked();
    expect(await answerAssignRequest(w.as(w.admin), w.task.id, { accept: false, reason: "Busy until next week" })).toEqual({ status: "RETURNED" });
    expect(await coIdsOf(w.task.id)).toEqual([w.member2.id]);
    expect((await db.taskAssignRequest.findUniqueOrThrow({ where: { id: w.of(w.admin.id).id } }))).toMatchObject({ status: "RETURNED", reason: "Busy until next week" });
    expect((await db.taskAssignRequest.findUniqueOrThrow({ where: { id: w.of(w.owner.id).id } })).status).toBe("PENDING");
    const bell = await bells(w.lead.id, "task_assign_returned");
    expect(bell).toHaveLength(1);
    expect(bell[0]!.body).toContain("Busy until next week");
    // a returned person can be asked again
    const again = await updateTask(w.as(w.lead), w.task.id, { coAssigneeIds: [w.member2.id, w.admin.id] });
    expect(again.coRequests.map((r) => r.toUserId)).toEqual([w.admin.id]);
  });

  it("only the person it was asked of (or the owner) answers theirs: the others are refused", async () => {
    const w = await asked();
    for (const person of [w.member, w.member2, w.lead]) {
      await expect(answerAssignRequest(w.as(person), w.task.id, { accept: true }), person.name).rejects.toMatchObject({ message: "taskreq.not_addressee" });
    }
    // the owner may answer for somebody else, by naming the request
    expect(await answerAssignRequest(w.as(w.owner), w.task.id, { accept: true }, w.of(w.admin.id).id)).toEqual({ status: "ACCEPTED" });
    expect(await coIdsOf(w.task.id)).toEqual(sorted(w.admin.id, w.member2.id));
    // an admin cannot name the owner's request to answer it
    await expect(answerAssignRequest(w.as(w.admin), w.task.id, { accept: true }, w.of(w.owner.id).id)).rejects.toMatchObject({ message: "taskreq.not_addressee" });
  });

  it("a main request and a request beside the first live together: each person answers their own, in either order", async () => {
    const w = await world();
    const task = await createTask(w.as(w.lead), w.input(w.admin.id, [w.member.id, w.owner.id]));
    expect(task.assigneeId).toBeNull();
    // the person asked for beside the first answers first: they join, and the task, which has nobody yet, becomes theirs
    expect(await answerAssignRequest(w.as(w.owner), task.id, { accept: true }, (await requests(task.id)).find((r) => r.toUserId === w.owner.id)!.id)).toEqual({ status: "ACCEPTED" });
    expect((await db.task.findUniqueOrThrow({ where: { id: task.id } })).assigneeId).toBe(w.owner.id);
    // then the first person asked answers: the task becomes theirs (the main kind replaces the assignee), the owner is not duplicated
    expect(await answerAssignRequest(w.as(w.admin), task.id, { accept: true })).toEqual({ status: "ACCEPTED" });
    const after = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(after.assigneeId).toBe(w.admin.id);
    expect(await coIdsOf(task.id)).toEqual([w.member.id]);
  });

  it("the HTTP doors accept the request id (and still work without one)", async () => {
    const w = await asked();
    await loginAs(w.owner.id);
    const noBody = await call(acceptRoute.POST, { params: { id: w.task.id } });
    expect(noBody.status).toBe(200);
    expect(await coIdsOf(w.task.id)).toEqual(sorted(w.owner.id, w.member2.id));
    await loginAs(w.admin.id);
    const noReason = await call(returnRoute.POST, { params: { id: w.task.id }, body: { requestId: w.of(w.admin.id).id, reason: " " } });
    expect(noReason.status).toBe(422);
    const returned = await call(returnRoute.POST, { params: { id: w.task.id }, body: { requestId: w.of(w.admin.id).id, reason: "Not now" } });
    expect(returned.status).toBe(200);
    expect(returned.json).toEqual({ status: "RETURNED" });
    expect((await call(acceptRoute.POST, { params: { id: w.task.id }, body: { requestId: w.of(w.admin.id).id } })).status).toBe(403);
  });
});

describe("the instant task (the «لمين» box)", () => {
  it("lower people are assigned and told; a higher one is asked and told by the request; `requested` says so", async () => {
    const w = await world();
    const ctx = ctxOf(w.org.id, w.lead.id, "LEAD");
    const made = await createInstantTask(ctx, w.ws.id, { title: "Quick one", assigneeIds: [w.member.id, w.admin.id, w.member2.id], priority: "NORMAL", dueDate: null });
    expect(made.requested).toBe(true);
    const task = await db.task.findUniqueOrThrow({ where: { id: made.id } });
    expect(task.assigneeId).toBe(w.member.id);
    expect(await coIdsOf(made.id)).toEqual([w.member2.id]);
    expect((await requests(made.id)).map((r) => [r.toUserId, r.asCo])).toEqual([[w.admin.id, true]]);
    expect(await bells(w.member.id, "task_assigned")).toHaveLength(1);
    expect(await bells(w.member2.id, "task_assigned")).toHaveLength(1);
    expect(await bells(w.admin.id, "task_assigned")).toEqual([]);
    expect(await bells(w.admin.id, "task_assign_request")).toHaveLength(1);

    // nobody above: nothing was asked
    const plain = await createInstantTask(ctx, w.ws.id, { title: "Plain", assigneeIds: [w.member.id, w.member2.id], priority: "NORMAL", dueDate: null });
    expect(plain.requested).toBe(false);
  });

  it("the first person above the giver: the task is born with the others on it and one request for the first", async () => {
    const w = await world();
    const ctx = ctxOf(w.org.id, w.member.id, "MEMBER");
    const made = await createInstantTask(ctx, w.ws.id, { title: "Up first", assigneeIds: [w.admin.id, w.member2.id], priority: "HIGH", dueDate: null });
    expect(made.requested).toBe(true);
    expect((await db.task.findUniqueOrThrow({ where: { id: made.id } })).assigneeId).toBeNull();
    expect(await coIdsOf(made.id)).toEqual([w.member2.id]);
    expect((await requests(made.id)).map((r) => [r.toUserId, r.asCo])).toEqual([[w.admin.id, false]]);
    expect(await bells(w.member2.id, "task_assigned")).toHaveLength(1);
  });

  it("the HTTP door: assigneeIds with a higher person in the middle answers 201 and the task shows the real people", async () => {
    const w = await world();
    jar().set(SPACE_COOKIE, w.ws.id);
    await loginAs(w.member.id);
    const res = await call(instantTaskRoute.POST, { body: { title: "Over HTTP", assigneeIds: [w.member2.id, w.admin.id, w.member3.id], priority: "NORMAL" } });
    expect(res.status).toBe(201);
    const made = res.json?.["task"] as { id: string; requested: boolean };
    expect(made.requested).toBe(true);
    expect(await coIdsOf(made.id)).toEqual([w.member3.id]);
    expect((await requests(made.id)).map((r) => r.toUserId)).toEqual([w.admin.id]);
  });
});
