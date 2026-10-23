import { beforeEach, describe, expect, it } from "vitest";
import * as conversationsRoute from "@/app/api/chat/conversations/route";
import * as conversationMessagesRoute from "@/app/api/chat/conversations/[id]/messages/route";
import * as joinRoute from "@/app/api/chat/conversations/[id]/join/route";
import { changeWorkspaceMembers } from "@/server/services/workspaces";
import { resetPresenceForTests } from "@/server/realtime/presence";
import { call, db, loginAs, makeTeam, makeUser, makeWorkspace, uid } from "./helpers";

let t: Awaited<ReturnType<typeof makeTeam>>;
let poster: Awaited<ReturnType<typeof makeUser>>;
let kicked: Awaited<ReturnType<typeof makeUser>>;
let stays: Awaited<ReturnType<typeof makeUser>>;
let spaceId: string;
let topicId: string;

beforeEach(async () => {
  resetPresenceForTests(); // nobody has a live stream: everybody counts as offline
  t = await makeTeam();
  poster = await makeUser({ orgId: t.org.id, name: "Poster" });
  kicked = await makeUser({ orgId: t.org.id, name: "Kicked" });
  stays = await makeUser({ orgId: t.org.id, name: "Stays" });
  const ws = await makeWorkspace(t.org.id, [{ userId: poster.id }, { userId: kicked.id }, { userId: stays.id }, { userId: t.admin.id, role: "ADMIN" }]);
  spaceId = ws.id;
  topicId = (await db.conversation.create({ data: { orgId: t.org.id, kind: "TOPIC", spaceId, title: "General" } })).id;
  // both join the topic (a ConversationMember row each), the way the old groups' people have rows
  for (const who of [kicked, stays]) {
    await loginAs(who.id);
    expect((await call(joinRoute.POST, { url: `http://localhost/api/chat/conversations/${topicId}`, params: { id: topicId } })).status).toBe(200);
  }
});

async function post(body: string, opts: { mentions?: string[]; replyToId?: string; conversationId?: string } = {}) {
  await loginAs(poster.id);
  const res = await call(conversationMessagesRoute.POST, {
    params: { id: opts.conversationId ?? topicId },
    body: { body, ...(opts.mentions ? { mentions: opts.mentions } : {}), ...(opts.replyToId ? { replyToId: opts.replyToId } : {}) },
  });
  expect(res.status).toBe(201);
  return res.json?.["id"] as string;
}

const bellHas = async (userId: string, text: string) =>
  (await db.notification.count({ where: { userId, type: "chat_message", body: { contains: text } } })) > 0;

describe("chat: somebody taken out of a space stops receiving its messages", () => {
  it("removing a person from the space also takes them out of its topics' rows", async () => {
    await changeWorkspaceMembers({ userId: t.owner.id, orgRole: "OWNER" }, spaceId, { remove: [kicked.id] });
    expect(await db.conversationMember.count({ where: { userId: kicked.id, conversation: { spaceId } } })).toBe(0);
    expect(await db.conversationMember.count({ where: { userId: stays.id, conversation: { spaceId } } })).toBe(1);
  });

  it("even a row left behind (older data) brings no notification: the policy decides, not the row", async () => {
    // remove the space row only, the way the old code did, leaving the topic row in place
    await db.workspaceMember.deleteMany({ where: { workspaceId: spaceId, userId: kicked.id } });
    const text = `after removal ${uid()}`;
    await post(text, { mentions: [kicked.id, stays.id] });
    expect(await bellHas(kicked.id, text)).toBe(false);
    expect(await bellHas(stays.id, text)).toBe(true);
    // and the mention itself is not stored for somebody who may not read the topic
    const msg = await db.chatMessage.findFirstOrThrow({ where: { body: text } });
    expect(msg.mentions).toEqual([stays.id]);
  });
});

describe("chat: a topic notifies only the people it addresses (spec §32)", () => {
  it("a plain topic message notifies nobody; an @mention notifies that person only", async () => {
    const plain = `plain ${uid()}`;
    await post(plain);
    for (const who of [kicked, stays, t.admin]) expect(await bellHas(who.id, plain), who.name).toBe(false);

    const mention = `mention ${uid()}`;
    await post(mention, { mentions: [stays.id] });
    expect(await bellHas(stays.id, mention)).toBe(true);
    expect(await bellHas(kicked.id, mention)).toBe(false);
  });

  it("a space member without a topic row can be @mentioned (the space is the audience of an open topic)", async () => {
    const text = `to the admin ${uid()}`;
    await post(text, { mentions: [t.admin.id] });
    expect(await bellHas(t.admin.id, text)).toBe(true);
  });

  it("a reply notifies the author of the message replied to", async () => {
    await loginAs(stays.id);
    const original = await call(conversationMessagesRoute.POST, { params: { id: topicId }, body: { body: "question" } });
    const text = `answer ${uid()}`;
    await post(text, { replyToId: original.json?.["id"] as string });
    expect(await bellHas(stays.id, text)).toBe(true);
  });

  it("nobody outside a restricted topic is notified, even when @mentioned", async () => {
    const restricted = await db.conversation.create({
      data: { orgId: t.org.id, kind: "TOPIC", spaceId, title: "Managers", restricted: true, members: { create: [{ userId: poster.id }] } },
    });
    const text = `restricted ${uid()}`;
    await post(text, { conversationId: restricted.id, mentions: [stays.id] });
    expect(await bellHas(stays.id, text)).toBe(false);
  });

  it("a DM still notifies its other person", async () => {
    await loginAs(poster.id);
    const dm = await call(conversationsRoute.POST, { body: { kind: "DM", userId: stays.id } });
    const text = `dm ${uid()}`;
    await post(text, { conversationId: dm.json?.["id"] as string });
    expect(await bellHas(stays.id, text)).toBe(true);
  });
});
