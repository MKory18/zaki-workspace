import { describe, expect, it } from "vitest";
import * as purgeRoute from "@/app/api/chat/conversations/[id]/purge/route";
import * as homeRoute from "@/app/api/chat/home/route";
import * as featuresRoute from "@/app/api/settings/features/route";
import { call, db, loginAs, makeTeam, makeWorkspace } from "./helpers";

/**
 * «حذف نهائي» (the owner's ask, 2026-10-26: «حذف كامل لاي ... موضوع دردشة او توبك بيد المالك فقط وحتى لو فيها
 * محادثات»): the OWNER deletes a topic or a chat with everything in it; nobody else; never a space's starter topic;
 * and the list tells the screen whether to offer it.
 */
async function world() {
  const t = await makeTeam();
  const ws = await makeWorkspace(t.org.id, [{ userId: t.admin.id, role: "ADMIN" }, { userId: t.member.id }]);
  const topic = await db.conversation.create({ data: { orgId: t.org.id, kind: "TOPIC", spaceId: ws.id, title: "Old plans" } });
  const msg = await db.chatMessage.create({ data: { orgId: t.org.id, conversationId: topic.id, authorId: t.member.id, body: "first draft", kind: "TEXT", mentions: [] } });
  const file = await db.storedFile.create({
    data: { orgId: t.org.id, uploaderId: t.member.id, name: "draft.png", mimeType: "image/png", size: 10, path: "x/draft.png", purpose: "CHAT", familyId: "fam-draft" },
  });
  await db.messageAttachment.create({ data: { messageId: msg.id, fileId: file.id, kind: "IMAGE" } });
  await db.notification.create({ data: { userId: t.admin.id, type: "chat_message", title: "Member", body: "first draft", linkUrl: `/chat/${topic.id}?m=${msg.id}` } });
  return { ...t, ws, topic, msg, file };
}
const purge = (id: string) => call(purgeRoute.POST, { params: { id } });

describe("the owner's «حذف نهائي»", () => {
  it("deletes a topic with its messages, takes its files out of reach and drops its notifications", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    expect((await purge(w.topic.id)).status).toBe(200);
    expect(await db.conversation.count({ where: { id: w.topic.id } })).toBe(0);
    expect(await db.chatMessage.count({ where: { id: w.msg.id } })).toBe(0);
    expect((await db.storedFile.findUniqueOrThrow({ where: { id: w.file.id } })).deletedAt).not.toBeNull();
    expect(await db.notification.count({ where: { userId: w.admin.id } })).toBe(0);
  });

  it("is the owner's alone: a space admin and a member are refused, nothing is touched", async () => {
    const w = await world();
    for (const who of [w.admin, w.member]) {
      await loginAs(who.id);
      const res = await purge(w.topic.id);
      expect(res.status).toBe(403);
      expect(res.json?.["message"]).toBe("chat.e.owner_only");
    }
    expect(await db.chatMessage.count({ where: { conversationId: w.topic.id } })).toBe(1);
  });

  it("never a space's starter topic", async () => {
    const w = await world();
    const general = await db.conversation.create({ data: { orgId: w.org.id, kind: "TOPIC", spaceId: w.ws.id, title: "عام", systemKey: "general" } });
    await loginAs(w.owner.id);
    const res = await purge(general.id);
    expect(res.status).toBe(403);
    expect(res.json?.["message"]).toBe("chat.topic_system");
    expect(await db.conversation.count({ where: { id: general.id } })).toBe(1);
  });

  it("the list offers the menu, and «حذف نهائي» to the owner only; switched off, neither, and the door is closed", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    expect((await call(homeRoute.GET)).json).toMatchObject({ rowMenu: true, canPurge: true });
    await loginAs(w.admin.id);
    expect((await call(homeRoute.GET)).json).toMatchObject({ rowMenu: true, canPurge: false });

    await loginAs(w.owner.id);
    await call(featuresRoute.PATCH, { method: "PATCH", body: { key: "chatRowMenu", on: false } });
    expect((await call(homeRoute.GET)).json).toMatchObject({ rowMenu: false, canPurge: false });
    expect((await purge(w.topic.id)).status).toBe(404);
    expect(await db.conversation.count({ where: { id: w.topic.id } })).toBe(1);
  });
});
