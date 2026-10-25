import { describe, expect, it } from "vitest";
import * as taskRoute from "@/app/api/chat/messages/[id]/task/route";
import * as ticketRoute from "@/app/api/chat/messages/[id]/ticket/route";
import * as conversationRoute from "@/app/api/chat/conversations/[id]/route";
import { titleFrom } from "@/server/chat/make-work";
import { call, db, loginAs, makeUser, uid } from "./helpers";
import { makeTeamsWorld } from "./teams-helpers";
import { makeDepartment } from "./guest-helpers";

/**
 * A CHAT MESSAGE BECOMES A TASK OR A TICKET (the owner's ask, 2026-10-25). The task or ticket carries the message's
 * text and a link back to it, and the message shows what it became. Only from a message one reads, never a deleted
 * one, never by a guest; the task's own rules (a project one works in) still hold. And the conversation lists its
 * pinned messages for the bar on top.
 */

type Detail = {
  messages: Array<{ id: string; work?: { kind: string; id: string }[] }>;
  me: { canMakeWork?: boolean };
  pinnedMessages?: { id: string; preview: string | null }[];
};

async function world() {
  const w = await makeTeamsWorld();
  const open = await db.conversation.create({ data: { orgId: w.org.id, kind: "TOPIC", spaceId: w.s.id, title: `Open ${uid()}` } });
  const ty = await db.conversation.create({ data: { orgId: w.org.id, kind: "TOPIC", spaceId: w.s.id, title: `Y ${uid()}`, teamId: w.y.id } });
  const msg = await db.chatMessage.create({
    data: { orgId: w.org.id, conversationId: open.id, authorId: w.bob.id, body: "Fix the login page\nit breaks on phones" },
  });
  const target = { workspaceId: w.s.id, projectId: w.p0.project.id, boardId: w.p0.board.id };
  return { ...w, open, ty, msg, target };
}

describe("«اعمل منها مهمة»", () => {
  it("a task in the project, titled by the message's first line, its text and a link back; the message shows it", async () => {
    const w = await world();
    await loginAs(w.carol.id);
    const res = await call(taskRoute.POST, { params: { id: w.msg.id }, body: w.target });
    expect(res.status).toBe(201);
    const task = await db.task.findUniqueOrThrow({ where: { id: (res.json as { taskId: string }).taskId }, select: { title: true, description: true, sourceMessageId: true, creatorId: true, projectId: true } });
    expect(task).toMatchObject({ title: "Fix the login page", sourceMessageId: w.msg.id, creatorId: w.carol.id, projectId: w.p0.project.id });
    expect(task.description).toContain("it breaks on phones");
    expect(task.description).toContain(`/chat/${w.open.id}?m=${w.msg.id}`);

    const detail = (await call(conversationRoute.GET, { params: { id: w.open.id } })).json as unknown as Detail;
    expect(detail.me.canMakeWork).toBe(true);
    expect(detail.messages.find((m) => m.id === w.msg.id)?.work).toEqual([{ kind: "task", id: (res.json as { taskId: string }).taskId }]);
  });

  it("not from a message one cannot read (404), not from a deleted message, not into a project of another space", async () => {
    const w = await world();
    const hidden = await db.chatMessage.create({ data: { orgId: w.org.id, conversationId: w.ty.id, authorId: w.bob.id, body: "Y only" } });
    await loginAs(w.carol.id);
    expect((await call(taskRoute.POST, { params: { id: hidden.id }, body: w.target })).status).toBe(404);

    await db.chatMessage.update({ where: { id: w.msg.id }, data: { deletedAt: new Date() } });
    const gone = await call(taskRoute.POST, { params: { id: w.msg.id }, body: w.target });
    expect(gone.status).toBe(403);
    expect(gone.json?.["message"]).toBe("chat.work_not_from_this");

    const fresh = await db.chatMessage.create({ data: { orgId: w.org.id, conversationId: w.open.id, authorId: w.bob.id, body: "another" } });
    // carol is not in the other space: its project is not hers to fill
    const elsewhere = await call(taskRoute.POST, { params: { id: fresh.id }, body: { workspaceId: w.other.id, projectId: w.pt.project.id, boardId: w.pt.board.id } });
    expect([403, 404]).toContain(elsewhere.status);
    expect(await db.task.count({ where: { sourceMessageId: fresh.id } })).toBe(0);
  });

  it("a guest makes no work of a message (403) and is not offered it", async () => {
    const w = await world();
    const guest = await makeUser({ orgId: w.org.id, role: "GUEST", name: `Guest ${uid()}` });
    await db.workspaceMember.create({ data: { workspaceId: w.s.id, userId: guest.id, role: "GUEST" } });
    await loginAs(guest.id);
    expect((await call(ticketRoute.POST, { params: { id: w.msg.id }, body: { departmentId: "x" } })).status).toBe(403);
    const detail = (await call(conversationRoute.GET, { params: { id: w.open.id } })).json as unknown as Detail;
    expect(detail.me.canMakeWork).toBe(false);
  });
});

describe("«اعمل منها تذكرة»", () => {
  it("a ticket to the department with the message's text; the message shows it", async () => {
    const w = await world();
    const dept = await makeDepartment(w.org.id);
    await loginAs(w.carol.id);
    const res = await call(ticketRoute.POST, { params: { id: w.msg.id }, body: { departmentId: dept.id, priority: "HIGH" } });
    expect(res.status).toBe(201);
    const ticket = await db.ticket.findUniqueOrThrow({ where: { id: (res.json as { ticketId: string }).ticketId }, select: { title: true, priority: true, sourceMessageId: true, departmentId: true } });
    expect(ticket).toEqual({ title: "Fix the login page", priority: "HIGH", sourceMessageId: w.msg.id, departmentId: dept.id });
    const detail = (await call(conversationRoute.GET, { params: { id: w.open.id } })).json as unknown as Detail;
    expect(detail.messages.find((m) => m.id === w.msg.id)?.work?.map((x) => x.kind)).toEqual(["ticket"]);
  });
});

describe("the pinned bar", () => {
  it("the conversation lists its pinned messages, newest first — not a deleted one", async () => {
    const w = await world();
    const at = (min: number) => new Date(Date.now() - min * 60_000);
    const a = await db.chatMessage.create({ data: { orgId: w.org.id, conversationId: w.open.id, authorId: w.bob.id, body: "first rule", pinned: true, createdAt: at(30) } });
    const b = await db.chatMessage.create({ data: { orgId: w.org.id, conversationId: w.open.id, authorId: w.bob.id, body: "second rule", pinned: true, createdAt: at(20) } });
    await db.chatMessage.create({ data: { orgId: w.org.id, conversationId: w.open.id, authorId: w.bob.id, body: "gone", pinned: true, deletedAt: new Date(), createdAt: at(10) } });
    await loginAs(w.carol.id);
    const detail = (await call(conversationRoute.GET, { params: { id: w.open.id } })).json as unknown as Detail;
    expect(detail.pinnedMessages?.map((p) => p.id)).toEqual([b.id, a.id]);
    expect(detail.pinnedMessages?.[0]?.preview).toBe("second rule");
  });
});

describe("the title from a message", () => {
  it("is its first line, cut at a word when long", () => {
    expect(titleFrom("one line\nmore")).toBe("one line");
    const long = titleFrom(`${"word ".repeat(40)}end`, 30);
    expect(long.endsWith("…")).toBe(true);
    expect(long.length).toBeLessThanOrEqual(31);
  });
});
