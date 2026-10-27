import { afterEach, describe, expect, it } from "vitest";
import * as instantRoute from "@/app/api/instant/route";
import * as instantTaskRoute from "@/app/api/instant/task/route";
import * as instantTicketRoute from "@/app/api/instant/ticket/route";
import * as instantTicketsRoute from "@/app/api/tickets/instant/route";
import * as mineRoute from "@/app/api/tickets/mine/route";
import * as ticketRoute from "@/app/api/tickets/[id]/route";
import * as detailRoute from "@/app/api/tickets/[id]/detail/route";
import * as featuresRoute from "@/app/api/settings/features/route";
import { SPACE_COOKIE } from "@/server/services/current-space";
import { INSTANT_PROJECT_KEY } from "@/server/services/instant-work";
import { call, db, loginAs, makeTeam, makeUser, makeWorkspace } from "./helpers";

/**
 * «مهمة فورية» and «تذكرة فورية» (the owner's ask, 2026-10-27): a task or a ticket typed in one go and handed to one
 * person with a priority — the task with no project to pick (the space's own «مهام فورية»), the ticket with no
 * department; both behind the «instantWork» switch.
 */
const jar = () => (globalThis as { __zkCookieJar?: Map<string, string> }).__zkCookieJar as Map<string, string>;
afterEach(() => jar().delete(SPACE_COOKIE));

async function world() {
  const t = await makeTeam();
  const outsider = await makeUser({ orgId: t.org.id, role: "MEMBER", name: "Outsider" });
  const ws = await makeWorkspace(t.org.id, [{ userId: t.admin.id, role: "ADMIN" }, { userId: t.member.id }]);
  jar().set(SPACE_COOKIE, ws.id);
  return { ...t, ws, outsider };
}
const sendTask = (body: unknown) => call(instantTaskRoute.POST, { body });
const sendTicket = (body: unknown) => call(instantTicketRoute.POST, { body });

describe("«مهمة فورية»", () => {
  it("lands in the space's own «مهام فورية» to the chosen person, with its priority and day, and tells them", async () => {
    const w = await world();
    await loginAs(w.admin.id);
    const info = await call(instantRoute.GET);
    expect(info.json).toMatchObject({ task: true, ticket: true, space: { id: w.ws.id } });
    expect((info.json?.["people"] as { id: string }[]).map((p) => p.id).sort()).toEqual([w.admin.id, w.member.id].sort());

    const due = new Date("2026-10-28T20:59:00.000Z").toISOString();
    const res = await sendTask({ title: "Call the supplier", assigneeId: w.member.id, priority: "URGENT", dueDate: due });
    expect(res.status).toBe(201);
    const id = (res.json?.["task"] as { id: string }).id;
    const task = await db.task.findUniqueOrThrow({ where: { id }, include: { project: true, column: true } });
    expect(task).toMatchObject({ assigneeId: w.member.id, priority: "URGENT", workspaceId: w.ws.id, creatorId: w.admin.id });
    expect(task.dueDate?.toISOString()).toBe(due);
    expect(task.project.systemKey).toBe(INSTANT_PROJECT_KEY);
    expect(task.column.done).toBe(false);
    expect(task.column.position).toBe(1); // «للتنفيذ», not the backlog
    expect(await db.notification.count({ where: { userId: w.member.id } })).toBe(1);

    // the next one goes to the same project, even renamed
    await db.project.update({ where: { id: task.projectId }, data: { name: "Quick ones" } });
    const again = await sendTask({ title: "Second", assigneeId: w.admin.id, priority: "LOW" });
    const second = await db.task.findUniqueOrThrow({ where: { id: (again.json?.["task"] as { id: string }).id } });
    expect(second.projectId).toBe(task.projectId);
    expect(await db.project.count({ where: { workspaceId: w.ws.id, systemKey: INSTANT_PROJECT_KEY } })).toBe(1);
    // to oneself: nobody to tell
    expect(await db.notification.count({ where: { userId: w.admin.id } })).toBe(0);
  });

  it("never to somebody outside the space, and never by a guest", async () => {
    const w = await world();
    await loginAs(w.admin.id);
    const res = await sendTask({ title: "Lost", assigneeId: w.outsider.id, priority: "NORMAL" });
    expect(res.status).toBe(403);
    expect(res.json?.["message"]).toBe("instant.not_in_space");
    expect(await db.task.count({ where: { workspaceId: w.ws.id } })).toBe(0);

    await loginAs(w.guest.id);
    expect((await call(instantRoute.GET)).json).toMatchObject({ task: false, ticket: false });
    expect([403, 404]).toContain((await sendTask({ title: "x", assigneeId: w.member.id })).status);
  });
});

describe("«تذكرة فورية»", () => {
  it("has no department, goes to the person, shows in «تذاكري» on both sides and to the managers", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const res = await sendTicket({ title: "Printer is down", assigneeId: w.outsider.id, priority: "HIGH" });
    expect(res.status).toBe(201);
    const id = (res.json?.["ticket"] as { id: string }).id;
    expect(await db.ticket.findUniqueOrThrow({ where: { id } })).toMatchObject({ departmentId: null, assigneeId: w.outsider.id, priority: "HIGH" });
    expect(await db.notification.count({ where: { userId: w.outsider.id, type: "ticket_assigned" } })).toBe(1);

    const ids = async () => ((await call(mineRoute.GET)).json?.["tickets"] as { id: string; department: unknown }[]).filter((r) => r.id === id);
    expect(await ids()).toEqual([expect.objectContaining({ id, department: null })]);
    await loginAs(w.outsider.id);
    expect(await ids()).toHaveLength(1);

    await loginAs(w.owner.id);
    expect(((await call(instantTicketsRoute.GET)).json?.["tickets"] as { id: string }[]).map((r) => r.id)).toEqual([id]);
    await loginAs(w.member.id);
    expect((await call(instantTicketsRoute.GET)).json?.["tickets"]).toEqual([]);
  });

  it("the person holding it works it; somebody else neither reads nor touches it", async () => {
    const w = await world();
    const other = await makeUser({ orgId: w.org.id, role: "MEMBER", name: "Other" });
    await loginAs(w.member.id);
    const id = ((await sendTicket({ title: "New laptop", assigneeId: w.outsider.id })).json?.["ticket"] as { id: string }).id;

    await loginAs(w.outsider.id);
    expect((await call(ticketRoute.PATCH, { method: "PATCH", params: { id }, body: { status: "IN_PROGRESS" } })).status).toBe(200);
    expect((await call(detailRoute.GET, { params: { id } })).json?.["ticket"]).toMatchObject({ departmentId: null, status: "IN_PROGRESS" });
    // handed on to anybody active in the company
    expect((await call(ticketRoute.PATCH, { method: "PATCH", params: { id }, body: { assigneeId: w.admin.id } })).status).toBe(200);

    await loginAs(other.id);
    expect((await call(detailRoute.GET, { params: { id } })).status).toBe(404);
    expect((await call(ticketRoute.PATCH, { method: "PATCH", params: { id }, body: { status: "CLOSED" } })).status).toBe(403);
  });
});

describe("the «instantWork» switch", () => {
  it("off: nothing is offered and both doors are closed; what was made stays", async () => {
    const w = await world();
    await loginAs(w.admin.id);
    const made = ((await sendTicket({ title: "Before the switch", assigneeId: w.member.id })).json?.["ticket"] as { id: string }).id;
    await loginAs(w.owner.id);
    expect((await call(featuresRoute.PATCH, { method: "PATCH", body: { key: "instantWork", on: false } })).status).toBe(200);

    await loginAs(w.admin.id);
    expect((await call(instantRoute.GET)).json).toMatchObject({ task: false, ticket: false, people: [] });
    expect((await sendTask({ title: "x", assigneeId: w.member.id })).status).toBe(404);
    expect((await sendTicket({ title: "xyz", assigneeId: w.member.id })).status).toBe(404);
    expect(await db.ticket.count({ where: { id: made } })).toBe(1);
  });
});
