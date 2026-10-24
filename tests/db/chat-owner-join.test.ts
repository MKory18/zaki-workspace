import { describe, expect, it } from "vitest";
import * as dmRoute from "@/app/api/chat/dm/route";
import * as conversationRoute from "@/app/api/chat/conversations/[id]/route";
import * as messagesRoute from "@/app/api/chat/conversations/[id]/messages/route";
import * as joinRoute from "@/app/api/chat/conversations/[id]/join/route";
import * as reactRoute from "@/app/api/chat/messages/[id]/react/route";
import * as pinRoute from "@/app/api/chat/messages/[id]/pin/route";
import type { ConversationDto } from "@/server/chat/dto";
import { call, db, loginAs, makeTeam, makeWorkspace } from "./helpers";

const detail = async (id: string) =>
  (await call(conversationRoute.GET, { url: `http://localhost/api/chat/conversations/${id}`, params: { id } })).json as unknown as ConversationDto;
const join = (id: string) => call(joinRoute.POST, { url: `http://localhost/api/chat/conversations/${id}/join`, params: { id } });
const send = (id: string, body: string) => call(messagesRoute.POST, { params: { id }, body: { body } });

async function topicWorld(topic: { closedAt?: Date; topicType?: string; postingPolicy?: string } = {}) {
  const t = await makeTeam();
  const ws = await makeWorkspace(t.org.id, [{ userId: t.member.id }, { userId: t.admin.id, role: "ADMIN" }]);
  const conv = await db.conversation.create({ data: { orgId: t.org.id, kind: "TOPIC", spaceId: ws.id, title: "General", ...topic } });
  return { ...t, ws, topic: conv };
}

describe("«شارك بالمحادثة»: the owner joins a topic to write in it", () => {
  it("in oversight he may join (not post); after joining he posts, and the join line is there for everybody", async () => {
    const w = await topicWorld();
    await loginAs(w.owner.id);
    const before = await detail(w.topic.id);
    expect(before.me).toMatchObject({ oversight: true, canPost: false, canJoin: true });
    expect((await send(w.topic.id, "قبل")).status).toBe(403);

    expect((await join(w.topic.id)).status).toBe(200);
    const after = await detail(w.topic.id);
    expect(after.me).toMatchObject({ oversight: false, canPost: true, canJoin: false });
    expect((await send(w.topic.id, "مرحبا يا شباب")).status).toBeLessThan(300);

    await loginAs(w.member.id);
    const seen = await detail(w.topic.id);
    expect(seen.messages.some((m) => m.kind === "SYSTEM" && m.system?.k === "join" && m.authorId === w.owner.id)).toBe(true);
    expect(seen.messages.some((m) => m.body === "مرحبا يا شباب")).toBe(true);
  });

  it("no join button on a closed topic, nor in a DM, nor for anybody but the owner", async () => {
    const closed = await topicWorld({ closedAt: new Date() });
    await loginAs(closed.owner.id);
    expect((await detail(closed.topic.id)).me.canJoin).toBe(false);

    await loginAs(closed.member.id);
    expect((await detail(closed.topic.id)).me.canJoin).toBe(false);

    const dm = (await call(dmRoute.POST, { body: { userId: closed.owner.id } })).json?.["id"] as string;
    await loginAs(closed.owner.id);
    expect((await detail(dm)).me.canJoin).toBe(false);
  });

  it("before joining, a reaction or a pin would break his silence: refused, and nothing written", async () => {
    const w = await topicWorld();
    await loginAs(w.member.id);
    const id = (await send(w.topic.id, "hi")).json?.["id"] as string;

    await loginAs(w.owner.id);
    const react = await call(reactRoute.POST, { params: { id }, body: { emoji: "👍" } });
    expect(react.status).toBe(403);
    expect(react.text).toContain("chat.e.join_first");
    expect((await call(pinRoute.POST, { params: { id } })).status).toBe(403);
    expect(await db.chatReaction.count({ where: { messageId: id } })).toBe(0);
    expect((await db.chatMessage.findUniqueOrThrow({ where: { id } })).pinned).toBe(false);

    // after joining, both are his
    expect((await join(w.topic.id)).status).toBe(200);
    expect((await call(reactRoute.POST, { params: { id }, body: { emoji: "👍" } })).status).toBeLessThan(300);
    expect((await call(pinRoute.POST, { params: { id } })).status).toBeLessThan(300);
  });

  it("a space admin posts in the announcements (the bar used to say «للقراءة فقط» to them too)", async () => {
    const w = await topicWorld({ topicType: "ANNOUNCEMENTS", postingPolicy: "ADMINS" });
    await loginAs(w.admin.id);
    expect((await detail(w.topic.id)).me.canPost).toBe(true);
    await loginAs(w.member.id);
    expect((await detail(w.topic.id)).me.canPost).toBe(false);
  });
});
