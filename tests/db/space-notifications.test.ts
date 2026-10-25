import { describe, expect, it } from "vitest";
import * as bellRoute from "@/app/api/notifications/route";
import * as readRoute from "@/app/api/notifications/read/route";
import * as taskRoute from "@/app/api/tasks/[id]/route";
import * as spaceMembersRoute from "@/app/api/workspaces/[id]/members/route";
import * as workspacesRoute from "@/app/api/workspaces/route";
import { ensureHqSpace } from "@/server/chat/hq";
import { notifyMessageToAudience } from "@/server/chat/notify";
import { pushNotification } from "@/server/notify";
import { SPACE_COOKIE } from "@/server/services/current-space";
import { call, db, loginAs, makeProject, makeTask, makeTeam, makeUser, makeWorkspace, uid } from "./helpers";

/**
 * THE BELL OF A SPACE (the owner's decision, 2026-10-25: each space is like a separate site). A notification belongs
 * to the space it is about (a task's, a message's, a space one was added to); the bell shows the space the person
 * is in and the personal ones (no space); the number beside every space on the switcher counts its notifications.
 */

const enter = (spaceId: string) => (globalThis as { __zkCookieJar?: Map<string, string> }).__zkCookieJar?.set(SPACE_COOKIE, spaceId);
type Bell = { items: Array<{ id: string; type: string; linkUrl: string | null }>; unreadCount: number };
const bell = async () => (await call(bellRoute.GET)).json as Bell;

/** Spaces A and B with the member in both; a task of A. */
async function world() {
  const team = await makeTeam();
  const orgId = team.org.id;
  const a = await makeWorkspace(orgId, [{ userId: team.member.id }, { userId: team.admin.id, role: "ADMIN" }], `A ${uid()}`);
  const b = await makeWorkspace(orgId, [{ userId: team.member.id }], `B ${uid()}`);
  const pa = await makeProject(a.id, `PA ${uid()}`);
  const task = await makeTask({ orgId, workspaceId: a.id, projectId: pa.project.id, boardId: pa.board.id, columnId: pa.todo.id, creatorId: team.owner.id, title: `TA ${uid()}` });
  return { ...team, a, b, task };
}

describe("a notification belongs to its space", () => {
  it("a task handed to somebody is its space's notice", async () => {
    const w = await world();
    await loginAs(w.admin.id);
    expect((await call(taskRoute.PATCH, { method: "PATCH", params: { id: w.task.id }, body: { assigneeId: w.member.id } })).status).toBe(200);
    const row = await db.notification.findFirstOrThrow({ where: { userId: w.member.id, type: "task_assigned" }, select: { workspaceId: true } });
    expect(row.workspaceId).toBe(w.a.id);
  });

  it("being put in a space is that space's notice, and its link enters it", async () => {
    const w = await world();
    const newcomer = await makeUser({ orgId: w.org.id, role: "MEMBER", name: `New ${uid()}` });
    await loginAs(w.admin.id);
    expect((await call(spaceMembersRoute.POST, { params: { id: w.a.id }, body: { addUserIds: [newcomer.id] } })).status).toBe(200);
    const row = await db.notification.findFirstOrThrow({ where: { userId: newcomer.id, type: "ws_member_added" }, select: { workspaceId: true, linkUrl: true } });
    expect(row.workspaceId).toBe(w.a.id);
    expect(row.linkUrl).toBe(`/go?space=${w.a.id}`);
  });

  it("a chat message is its conversation's space's; a DM from before spaces is «الشركة»'s", async () => {
    const w = await world();
    const hq = await ensureHqSpace(w.org.id, "الشركة");
    const topic = await db.conversation.create({ data: { orgId: w.org.id, kind: "TOPIC", spaceId: w.b.id, title: "B talk" } });
    const oldDm = await db.conversation.create({ data: { orgId: w.org.id, kind: "DM" } });
    for (const conv of [topic, oldDm]) {
      await notifyMessageToAudience({ conversationId: conv.id, authorId: w.admin.id, audienceIds: [w.member.id], kind: conv.kind as "TOPIC" | "DM", title: "t", preview: "p", messageId: `m${uid()}` });
    }
    const rows = await db.notification.findMany({ where: { userId: w.member.id, type: "chat_message" }, select: { workspaceId: true, linkUrl: true } });
    expect(rows.find((r) => r.linkUrl?.includes(topic.id))?.workspaceId).toBe(w.b.id);
    expect(rows.find((r) => r.linkUrl?.includes(oldDm.id))?.workspaceId).toBe(hq);
  });
});

describe("the bell shows the space you are in", () => {
  it("that space's notices and the personal ones, never another space's", async () => {
    const w = await world();
    await pushNotification({ userId: w.member.id, type: "x", title: "in A", workspaceId: w.a.id });
    await pushNotification({ userId: w.member.id, type: "x", title: "in B", workspaceId: w.b.id });
    await pushNotification({ userId: w.member.id, type: "welcome", title: "personal" });
    await loginAs(w.member.id);
    enter(w.a.id);
    const inA = await bell();
    expect(inA.unreadCount).toBe(2);
    enter(w.b.id);
    const inB = await bell();
    expect(inB.unreadCount).toBe(2);
    expect(inB.items.map((i) => i.type).sort()).toEqual(["welcome", "x"]);
  });

  it("«read all» reads the bell of this space only: another space's notices wait for it", async () => {
    const w = await world();
    await pushNotification({ userId: w.member.id, type: "x", title: "in A", workspaceId: w.a.id });
    await pushNotification({ userId: w.member.id, type: "x", title: "in B", workspaceId: w.b.id });
    await loginAs(w.member.id);
    enter(w.b.id);
    expect((await call(readRoute.POST, { body: { all: true } })).status).toBe(200);
    expect((await bell()).unreadCount).toBe(0);
    enter(w.a.id);
    expect((await bell()).unreadCount).toBe(1);
  });

  it("the number beside each space counts its notices", async () => {
    const w = await world();
    await pushNotification({ userId: w.member.id, type: "x", title: "in A", workspaceId: w.a.id });
    await pushNotification({ userId: w.member.id, type: "x", title: "in A again", workspaceId: w.a.id });
    await loginAs(w.member.id);
    const list = (await call(workspacesRoute.GET)).json as { organizations: Array<{ workspaces: Array<{ id: string; unread: number }> }> };
    const spaces = list.organizations.flatMap((o) => o.workspaces);
    expect(spaces.find((s) => s.id === w.a.id)?.unread).toBe(2);
    expect(spaces.find((s) => s.id === w.b.id)?.unread).toBe(0);
  });
});
