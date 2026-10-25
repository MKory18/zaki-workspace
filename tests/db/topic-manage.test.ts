import { describe, expect, it } from "vitest";
import * as homeRoute from "@/app/api/chat/home/route";
import * as unreadRoute from "@/app/api/chat/unread/route";
import * as topicRoute from "@/app/api/chat/topics/[id]/route";
import { canPostInConversation, canReadConversation } from "@/server/policy/conversation";
import { SPACE_COOKIE } from "@/server/services/current-space";
import { call, db, loginAs } from "./helpers";
import { makeTeamsWorld } from "./teams-helpers";

/**
 * A TOPIC'S MANAGEMENT (the owner's ask, 2026-10-25: close, delete, pin). The space's managers pin a topic on top,
 * archive it (out of the list, read-only, nothing deleted — they find it under «المؤرشفة» and bring it back) and
 * delete one nobody wrote in. A topic people wrote in is never deleted, and a system topic never is.
 */

const enter = (spaceId: string) => (globalThis as { __zkCookieJar?: Map<string, string> }).__zkCookieJar?.set(SPACE_COOKIE, spaceId);
const patch = (id: string, body: Record<string, unknown>) => call(topicRoute.PATCH, { method: "PATCH", params: { id }, body });
const remove = (id: string) => call(topicRoute.DELETE, { method: "DELETE", params: { id } });

type HomeTopic = { id: string; pinned: boolean; archived: boolean; unread: number };
async function topicsOf(userId: string, spaceId: string): Promise<HomeTopic[]> {
  await loginAs(userId);
  enter(spaceId);
  return ((await call(homeRoute.GET)).json as { spaces: Array<{ topics: HomeTopic[] }> }).spaces[0]?.topics ?? [];
}

async function world() {
  const w = await makeTeamsWorld();
  const topic = (title: string, position: number) =>
    db.conversation.create({ data: { orgId: w.org.id, kind: "TOPIC", spaceId: w.s.id, title, position } });
  const first = await topic("First", 0);
  const second = await topic("Second", 1);
  const third = await topic("Third", 2);
  return { ...w, first, second, third };
}

describe("pinning a topic", () => {
  it("a pinned topic comes first in the space's list, for everybody; unpinned, it goes back to its place", async () => {
    const w = await world();
    await loginAs(w.spaceAdmin.id);
    expect((await patch(w.third.id, { pinned: true })).status).toBe(200);

    const list = await topicsOf(w.carol.id, w.s.id);
    expect(list.map((t) => t.id).slice(0, 3)).toEqual([w.third.id, w.first.id, w.second.id]);
    expect(list.find((t) => t.id === w.third.id)?.pinned).toBe(true);

    await loginAs(w.spaceAdmin.id);
    await patch(w.third.id, { pinned: false });
    expect((await topicsOf(w.carol.id, w.s.id)).map((t) => t.id).slice(0, 3)).toEqual([w.first.id, w.second.id, w.third.id]);
  });

  it("a plain member does not pin, archive or delete (403)", async () => {
    const w = await world();
    await loginAs(w.carol.id);
    expect((await patch(w.first.id, { pinned: true })).status).toBe(403);
    expect((await patch(w.first.id, { archived: true })).status).toBe(403);
    expect((await remove(w.first.id)).status).toBe(403);
  });
});

describe("archiving a topic", () => {
  it("out of the members' list and their unread count, read-only, its words kept; the managers find it and bring it back", async () => {
    const w = await world();
    const before = new Date(Date.now() - 60_000);
    await db.conversationMember.create({ data: { conversationId: w.second.id, userId: w.carol.id, lastReadAt: before } });
    await db.chatMessage.create({ data: { orgId: w.org.id, conversationId: w.second.id, authorId: w.bob.id, body: "keep me" } });
    await loginAs(w.carol.id);
    enter(w.s.id);
    expect((await call(unreadRoute.GET)).json?.["total"]).toBe(1);

    await loginAs(w.spaceAdmin.id);
    expect((await patch(w.second.id, { archived: true })).status).toBe(200);

    expect((await topicsOf(w.carol.id, w.s.id)).map((t) => t.id)).not.toContain(w.second.id);
    expect((await call(unreadRoute.GET)).json?.["total"]).toBe(0);
    // still hers to read (a link to it works), nobody writes in it, nothing is gone
    expect(await canReadConversation(w.carol.id, w.second.id)).toBe(true);
    expect(await canPostInConversation(w.carol.id, w.second.id)).toBe(false);
    expect(await canPostInConversation(w.spaceAdmin.id, w.second.id)).toBe(false);
    expect(await db.chatMessage.count({ where: { conversationId: w.second.id } })).toBe(1);

    const managers = await topicsOf(w.spaceAdmin.id, w.s.id);
    expect(managers.find((t) => t.id === w.second.id)).toMatchObject({ archived: true, unread: 0 });
    // archived stays read-only until it is brought back: reopening it is refused
    await loginAs(w.spaceAdmin.id);
    const reopen = await patch(w.second.id, { closed: false });
    expect(reopen.status).toBe(409);
    expect(reopen.json?.["message"]).toBe("chat.topic_archived");

    expect((await patch(w.second.id, { archived: false })).status).toBe(200);
    expect((await topicsOf(w.carol.id, w.s.id)).map((t) => t.id)).toContain(w.second.id);
    expect(await canPostInConversation(w.carol.id, w.second.id)).toBe(true);
  });

  it("an archived topic loses its pin", async () => {
    const w = await world();
    await loginAs(w.spaceAdmin.id);
    await patch(w.first.id, { pinned: true });
    await patch(w.first.id, { archived: true });
    expect((await db.conversation.findUniqueOrThrow({ where: { id: w.first.id }, select: { pinnedAt: true } })).pinnedAt).toBeNull();
  });
});

describe("deleting a topic", () => {
  it("one nobody wrote in goes (system lines do not count as writing)", async () => {
    const w = await world();
    await db.chatMessage.create({ data: { orgId: w.org.id, conversationId: w.first.id, authorId: w.spaceAdmin.id, body: "{}", kind: "SYSTEM" } });
    await loginAs(w.spaceAdmin.id);
    expect((await remove(w.first.id)).status).toBe(200);
    expect(await db.conversation.findUnique({ where: { id: w.first.id } })).toBeNull();
  });

  it("one people wrote in is never deleted (409: archive it instead); a system topic never is (403)", async () => {
    const w = await world();
    await db.chatMessage.create({ data: { orgId: w.org.id, conversationId: w.first.id, authorId: w.bob.id, body: "my words" } });
    await loginAs(w.spaceAdmin.id);
    const refused = await remove(w.first.id);
    expect(refused.status).toBe(409);
    expect(refused.json?.["message"]).toBe("chat.topic_has_messages");
    expect(await db.chatMessage.count({ where: { conversationId: w.first.id } })).toBe(1);

    await db.conversation.update({ where: { id: w.second.id }, data: { systemKey: "general" } });
    const system = await remove(w.second.id);
    expect(system.status).toBe(403);
    expect(system.json?.["message"]).toBe("chat.topic_system");
  });

  it("the OWNER deletes an empty topic of any space", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    expect((await remove(w.third.id)).status).toBe(200);
  });
});
