import { describe, expect, it } from "vitest";
import * as unreadRoute from "@/app/api/chat/unread/route";
import * as dmRoute from "@/app/api/chat/dm/route";
import * as messagesRoute from "@/app/api/chat/conversations/[id]/messages/route";
import * as readRoute from "@/app/api/chat/conversations/[id]/read/route";
import * as joinRoute from "@/app/api/chat/conversations/[id]/join/route";
import * as topicRoute from "@/app/api/chat/topics/[id]/route";
import { call, db, loginAs, makeTeam, makeWorkspace } from "./helpers";

const total = async () => (await call(unreadRoute.GET)).json?.["total"] as number;
const send = async (id: string, body: string) => (await call(messagesRoute.POST, { params: { id }, body: { body } })).json?.["id"] as string;
const read = (id: string) => call(readRoute.POST, { method: "POST", url: `http://localhost/api/chat/conversations/${id}/read`, params: { id } });

async function world() {
  const t = await makeTeam();
  const ws = await makeWorkspace(t.org.id, [{ userId: t.member.id }, { userId: t.admin.id, role: "ADMIN" }, { userId: t.guest.id, role: "GUEST" }]);
  const topic = await db.conversation.create({ data: { orgId: t.org.id, kind: "TOPIC", spaceId: ws.id, title: "General" } });
  return { ...t, ws, topic };
}

describe("GET /api/chat/unread", () => {
  it("counts the other person's messages in my DM, and clears when I read", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const dm = (await call(dmRoute.POST, { body: { userId: w.admin.id } })).json?.["id"] as string;
    await send(dm, "one");
    await send(dm, "two");
    expect(await total()).toBe(0); // my own messages never count

    await loginAs(w.admin.id);
    expect(await total()).toBe(2);
    expect((await read(dm)).status).toBe(200);
    expect(await total()).toBe(0);
  });

  it("a topic counts once I have a row there; system lines never count", async () => {
    const w = await world();
    await loginAs(w.admin.id);
    await read(w.topic.id); // the admin opens the topic: their row starts here
    await loginAs(w.member.id);
    await send(w.topic.id, "hello");
    await loginAs(w.admin.id);
    expect(await total()).toBe(1);
    expect((await call(topicRoute.PATCH, { method: "PATCH", params: { id: w.topic.id }, body: { closed: true } })).status).toBeLessThan(300);
    await loginAs(w.member.id);
    await read(w.topic.id);
    expect(await total()).toBe(0); // the «أُغلق الموضوع» line is not a message to read
  });

  it("a topic of a space I left stops counting, though my row is still there", async () => {
    const w = await world();
    await loginAs(w.admin.id);
    await read(w.topic.id);
    await loginAs(w.member.id);
    await send(w.topic.id, "hello");
    await loginAs(w.admin.id);
    expect(await total()).toBe(1);
    await db.workspaceMember.deleteMany({ where: { workspaceId: w.ws.id, userId: w.admin.id } });
    expect(await total()).toBe(0);
  });

  it("the owner's silent oversight adds nothing; a topic he joined counts like anybody's", async () => {
    const w = await world();
    await loginAs(w.member.id);
    await send(w.topic.id, "before");
    await loginAs(w.owner.id);
    expect(await total()).toBe(0);
    expect((await call(joinRoute.POST, { url: `http://localhost/api/chat/conversations/${w.topic.id}/join`, params: { id: w.topic.id } })).status).toBe(200);
    await loginAs(w.member.id);
    await send(w.topic.id, "after he joined");
    await loginAs(w.owner.id);
    expect(await total()).toBe(1);
  });

  it("a guest counts the topics of their space", async () => {
    const w = await world();
    await loginAs(w.guest.id);
    await read(w.topic.id);
    await loginAs(w.member.id);
    await send(w.topic.id, "hi guests");
    await loginAs(w.guest.id);
    expect(await total()).toBe(1);
  });
});
