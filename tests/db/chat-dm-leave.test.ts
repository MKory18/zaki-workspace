import { describe, expect, it } from "vitest";
import * as conversationsRoute from "@/app/api/chat/conversations/route";
import * as conversationRoute from "@/app/api/chat/conversations/[id]/route";
import * as conversationMessagesRoute from "@/app/api/chat/conversations/[id]/messages/route";
import { call, db, loginAs, makeTeam } from "./helpers";

const HISTORY = "the history both of them keep";

async function dmWorld() {
  const t = await makeTeam();
  await loginAs(t.member.id);
  const dm = await call(conversationsRoute.POST, { body: { kind: "DM", userId: t.admin.id } });
  const dmId = dm.json?.["id"] as string;
  expect((await call(conversationMessagesRoute.POST, { params: { id: dmId }, body: { body: HISTORY } })).status).toBe(201);
  return { ...t, dmId };
}

const read = async (userId: string, dmId: string) => {
  await loginAs(userId);
  return call(conversationRoute.GET, { url: `http://localhost/api/chat/conversations/${dmId}`, params: { id: dmId } });
};

describe("chat: a DM is never left, so neither side is ever locked out of it", () => {
  it("leaving a DM is refused (403 chat.e.dm_leave_denied); both people keep reading it", async () => {
    const w = await dmWorld();
    await loginAs(w.member.id);
    const left = await call(conversationRoute.DELETE, { method: "DELETE", params: { id: w.dmId } });
    expect(left.status).toBe(403);
    expect(left.json?.["message"]).toBe("chat.e.dm_leave_denied");
    expect(await db.conversationMember.count({ where: { conversationId: w.dmId } })).toBe(2);
    for (const who of [w.member, w.admin]) {
      const res = await read(who.id, w.dmId);
      expect(res.status, who.name).toBe(200);
      expect(res.text).toContain(HISTORY);
    }
  });

  it("older data where one side's row is gone: the other side still reads, and opening the DM again brings the lost side back", async () => {
    const w = await dmWorld();
    // what the old leave did: the member's row deleted, the admin's left alone
    await db.conversationMember.deleteMany({ where: { conversationId: w.dmId, userId: w.member.id } });

    const stays = await read(w.admin.id, w.dmId);
    expect(stays.status).toBe(200);
    expect(stays.text).toContain(HISTORY);

    await loginAs(w.member.id);
    const again = await call(conversationsRoute.POST, { body: { kind: "DM", userId: w.admin.id } });
    expect(again.json?.["id"]).toBe(w.dmId);
    const back = await read(w.member.id, w.dmId);
    expect(back.status).toBe(200);
    expect(back.text).toContain(HISTORY);
  });

  it("leaving a topic or a group still works (only a DM is refused)", async () => {
    const t = await makeTeam();
    await loginAs(t.member.id);
    const group = await call(conversationsRoute.POST, { body: { kind: "GROUP", title: "Planning", memberIds: [t.admin.id] } });
    const groupId = group.json?.["id"] as string;
    await loginAs(t.admin.id);
    expect((await call(conversationRoute.DELETE, { method: "DELETE", params: { id: groupId } })).status).toBe(200);
    expect(await db.conversationMember.count({ where: { conversationId: groupId, userId: t.admin.id } })).toBe(0);
  });
});
