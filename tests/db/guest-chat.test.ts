import { describe, expect, it } from "vitest";
import * as conversationsRoute from "@/app/api/chat/conversations/route";
import * as conversationRoute from "@/app/api/chat/conversations/[id]/route";
import * as conversationMessagesRoute from "@/app/api/chat/conversations/[id]/messages/route";
import * as messageRoute from "@/app/api/chat/messages/[id]/route";
import * as pinRoute from "@/app/api/chat/messages/[id]/pin/route";
import * as reactRoute from "@/app/api/chat/messages/[id]/react/route";
import * as directoryRoute from "@/app/api/chat/directory/route";
import * as orgMemberRoute from "@/app/api/organizations/[id]/members/[userId]/route";
import { call, db, loginAs, logout, makeTeam } from "./helpers";

const DM_SECRET = "DM secret: the factory price is 41";
const GROUP_SECRET = "Group secret: launch on Monday";
const GROUP_TITLE = "Planning room";

/**
 * The owner opens a DM with the member and writes in it; the member then opens a group
 * (so the member is its admin) with the owner and the admin, and writes in it too.
 */
async function chatWorld() {
  const team = await makeTeam();

  await loginAs(team.owner.id);
  const dm = await call(conversationsRoute.POST, { body: { kind: "DM", userId: team.member.id } });
  expect(dm.status).toBe(201);
  const dmId = dm.json?.["id"] as string;
  const dmMessage = await call(conversationMessagesRoute.POST, { params: { id: dmId }, body: { body: DM_SECRET } });
  expect(dmMessage.status).toBe(201);

  await loginAs(team.member.id);
  const group = await call(conversationsRoute.POST, {
    body: { kind: "GROUP", title: GROUP_TITLE, memberIds: [team.owner.id, team.admin.id] },
  });
  expect(group.status).toBe(201);
  const groupId = group.json?.["id"] as string;
  const groupMessage = await call(conversationMessagesRoute.POST, { params: { id: groupId }, body: { body: GROUP_SECRET } });
  expect(groupMessage.status).toBe(201);

  return { ...team, dmId, groupId, groupMessageId: groupMessage.json?.["id"] as string };
}

type World = Awaited<ReturnType<typeof chatWorld>>;

/** The owner demotes the member to GUEST through the real members route. */
async function demoteMember(w: World) {
  await loginAs(w.owner.id);
  const res = await call(orgMemberRoute.PATCH, {
    method: "PATCH",
    params: { id: w.org.id, userId: w.member.id },
    body: { role: "GUEST" },
  });
  expect(res.status).toBe(200);
}

function expectClosed(res: { status: number; json: Record<string, unknown> | null; text: string }) {
  expect(res.status).toBe(403);
  expect(res.json?.["message"]).toBe("chat.guest_forbidden");
  expect(res.text).not.toContain(DM_SECRET);
  expect(res.text).not.toContain(GROUP_SECRET);
  expect(res.text).not.toContain(GROUP_TITLE);
}

describe("chat: a member demoted to GUEST loses every thread", () => {
  it("active group members can read and post in their group", async () => {
    const team = await makeTeam();
    await loginAs(team.member.id);
    const created = await call(conversationsRoute.POST, {
      body: { kind: "GROUP", title: GROUP_TITLE, memberIds: [team.owner.id, team.admin.id] },
    });
    expect(created.status).toBe(201);
    const groupId = created.json?.["id"] as string;

    expect((await call(conversationRoute.GET, { params: { id: groupId } })).status).toBe(200);
    expect(
      (await call(conversationMessagesRoute.POST, { params: { id: groupId }, body: { body: GROUP_SECRET } })).status,
    ).toBe(201);
  });

  it("before the demotion the member reads the list, both threads and marks them read", async () => {
    const w = await chatWorld();
    await loginAs(w.member.id);
    const list = await call(conversationsRoute.GET);
    expect(list.status).toBe(200);
    expect((list.json?.["conversations"] as unknown[]).length).toBe(2);
    expect((await call(conversationRoute.GET, { params: { id: w.dmId } })).text).toContain(DM_SECRET);
    expect((await call(conversationRoute.GET, { params: { id: w.groupId } })).text).toContain(GROUP_SECRET);
    expect((await call(conversationRoute.POST, { params: { id: w.dmId } })).status).toBe(200);
  });

  it("afterwards the list, both threads, mark-read and the directory are 403 and leak nothing", async () => {
    const w = await chatWorld();
    const before = await db.conversationMember.findUniqueOrThrow({
      where: { conversationId_userId: { conversationId: w.dmId, userId: w.member.id } },
    });
    await demoteMember(w);

    await loginAs(w.member.id);
    expectClosed(await call(conversationsRoute.GET));
    expectClosed(await call(conversationRoute.GET, { params: { id: w.dmId } }));
    expectClosed(await call(conversationRoute.GET, { params: { id: w.groupId } }));
    expectClosed(await call(conversationRoute.POST, { params: { id: w.dmId } }));
    expectClosed(await call(directoryRoute.GET));

    const after = await db.conversationMember.findUniqueOrThrow({
      where: { conversationId_userId: { conversationId: w.dmId, userId: w.member.id } },
    });
    expect(after.lastReadAt.getTime()).toBe(before.lastReadAt.getTime());
  });

  it("afterwards they cannot write either: send, edit, delete, pin, react, manage the group, leave it, open one", async () => {
    const w = await chatWorld();
    await demoteMember(w);
    await loginAs(w.member.id);

    const initialGroupMessageCount = await db.chatMessage.count({ where: { conversationId: w.groupId } });
    const attempts = [
      await call(conversationMessagesRoute.POST, { params: { id: w.groupId }, body: { body: "still here" } }),
      await call(messageRoute.PATCH, { method: "PATCH", params: { id: w.groupMessageId }, body: { body: "rewritten" } }),
      await call(messageRoute.DELETE, { method: "DELETE", params: { id: w.groupMessageId } }),
      await call(pinRoute.POST, { params: { id: w.groupMessageId } }),
      await call(reactRoute.POST, { params: { id: w.groupMessageId }, body: { emoji: "👍" } }),
      await call(conversationRoute.PATCH, {
        method: "PATCH",
        params: { id: w.groupId },
        body: { title: "Renamed by a guest", addUserIds: [w.guest.id], removeUserIds: [w.admin.id] },
      }),
      await call(conversationRoute.DELETE, { method: "DELETE", params: { id: w.groupId } }),
      await call(conversationsRoute.POST, { body: { kind: "DM", userId: w.owner.id } }),
      await call(conversationsRoute.POST, { body: { kind: "GROUP", title: "Guest group", memberIds: [w.owner.id] } }),
    ];
    for (const res of attempts) expectClosed(res);

    // the thread is exactly as it was
    const message = await db.chatMessage.findUniqueOrThrow({ where: { id: w.groupMessageId } });
    expect(message.body).toBe(GROUP_SECRET);
    expect(message.deletedAt).toBeNull();
    expect(message.pinned).toBe(false);
    expect(await db.chatMessage.count({ where: { conversationId: w.groupId } })).toBe(initialGroupMessageCount);
    expect(await db.chatReaction.count({ where: { messageId: w.groupMessageId } })).toBe(0);
    const group = await db.conversation.findUniqueOrThrow({
      where: { id: w.groupId },
      include: { members: { select: { userId: true } } },
    });
    expect(group.title).toBe(GROUP_TITLE);
    expect(group.members.map((m) => m.userId).sort()).toEqual([w.member.id, w.owner.id, w.admin.id].sort());
  });

  it("someone who was never a member answers 403 as well, not an empty list", async () => {
    const w = await chatWorld();
    await loginAs(w.guest.id);
    expectClosed(await call(conversationsRoute.GET));
    expectClosed(await call(conversationRoute.GET, { params: { id: w.dmId } }));
  });

  it("an anonymous caller still gets 401", async () => {
    await chatWorld();
    logout();
    expect((await call(conversationsRoute.GET)).status).toBe(401);
  });
});

describe("chat: everyone else is unaffected by the demotion", () => {
  it("the owner and the admin still read their threads, and write in them", async () => {
    const w = await chatWorld();
    await demoteMember(w);

    await loginAs(w.owner.id);
    const list = await call(conversationsRoute.GET);
    expect(list.status).toBe(200);
    expect((list.json?.["conversations"] as unknown[]).length).toBe(2);
    expect((await call(conversationRoute.GET, { params: { id: w.dmId } })).text).toContain(DM_SECRET);
    expect(
      (await call(conversationMessagesRoute.POST, { params: { id: w.groupId }, body: { body: "owner speaking" } })).status,
    ).toBe(201);
    expect((await call(conversationRoute.POST, { params: { id: w.groupId } })).status).toBe(200);

    await loginAs(w.admin.id);
    expect((await call(conversationRoute.GET, { params: { id: w.groupId } })).text).toContain(GROUP_SECRET);
    expect((await call(reactRoute.POST, { params: { id: w.groupMessageId }, body: { emoji: "👍" } })).status).toBe(200);
  });

  it("a member who stays a member can still pin, edit and leave", async () => {
    const w = await chatWorld();
    await loginAs(w.member.id);
    expect((await call(pinRoute.POST, { params: { id: w.groupMessageId } })).status).toBe(200);
    expect(
      (await call(messageRoute.PATCH, { method: "PATCH", params: { id: w.groupMessageId }, body: { body: "edited" } })).status,
    ).toBe(200);
    expect(
      (await call(conversationRoute.PATCH, { method: "PATCH", params: { id: w.groupId }, body: { title: "Renamed" } })).status,
    ).toBe(200);
    expect((await call(conversationRoute.DELETE, { method: "DELETE", params: { id: w.groupId } })).status).toBe(200);
  });
});
