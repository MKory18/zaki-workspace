import { beforeEach, describe, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import * as conversationsRoute from "@/app/api/chat/conversations/route";
import * as conversationRoute from "@/app/api/chat/conversations/[id]/route";
import * as conversationMessagesRoute from "@/app/api/chat/conversations/[id]/messages/route";
import * as messageRoute from "@/app/api/chat/messages/[id]/route";
import * as attachmentRoute from "@/app/api/chat/attachments/[id]/route";
import { claimUploads } from "@/server/chat/attachments";
import { call, db, loginAs, makeTeam, makeWorkspace, uid } from "./helpers";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

let t: Awaited<ReturnType<typeof makeTeam>>;
let topicId: string;

beforeEach(async () => {
  t = await makeTeam();
  const ws = await makeWorkspace(t.org.id, [{ userId: t.member.id }, { userId: t.admin.id }, { userId: t.guest.id, role: "GUEST" }]);
  topicId = (await db.conversation.create({ data: { orgId: t.org.id, kind: "TOPIC", spaceId: ws.id, title: "عام" } })).id;
});

/** A message of `authorId` in the topic carrying one image, claimed the way the send flow claims it. */
async function messageWithPhoto(authorId: string) {
  const id = uid();
  const dir = process.env["UPLOAD_DIR"] ?? path.join(process.cwd(), ".data", "uploads");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, id), PNG);
  const file = await db.storedFile.create({
    data: { id, orgId: t.org.id, uploaderId: authorId, familyId: id, name: "wrong-photo.png", mimeType: "image/png", size: PNG.length, path: id, purpose: "CHAT" },
  });
  const msg = await db.chatMessage.create({ data: { orgId: t.org.id, conversationId: topicId, authorId, body: "الصورة" } });
  await db.$transaction((tx) => claimUploads(tx, { orgId: t.org.id, uploaderId: authorId, conversationId: topicId, messageId: msg.id, attachmentIds: [file.id] }));
  const att = await db.messageAttachment.findFirstOrThrow({ where: { messageId: msg.id } });
  return { msg, att };
}

async function messageOf(viewerId: string, messageId: string) {
  await loginAs(viewerId);
  const res = await call(conversationRoute.GET, { url: `http://localhost/api/chat/conversations/${topicId}`, params: { id: topicId } });
  expect(res.status).toBe(200);
  return ((res.json?.["messages"] as { id: string; attachments: unknown[]; deleted: boolean }[]) ?? []).find((m) => m.id === messageId)!;
}

describe("chat: a deleted message takes its files with it", () => {
  it("the author deletes a message with a photo: members and guests no longer get the photo, the OWNER still does", async () => {
    const { msg, att } = await messageWithPhoto(t.member.id);
    await loginAs(t.member.id);
    expect((await call(messageRoute.DELETE, { method: "DELETE", params: { id: msg.id } })).status).toBeLessThan(300);

    for (const viewer of [t.member, t.admin, t.guest]) {
      const seen = await messageOf(viewer.id, msg.id);
      expect(seen.deleted, viewer.name).toBe(true);
      expect(seen.attachments, viewer.name).toEqual([]);
      await loginAs(viewer.id);
      expect((await call(attachmentRoute.GET, { url: `http://localhost/api/chat/attachments/${att.id}`, params: { id: att.id } })).status, viewer.name).toBe(404);
    }

    const asOwner = await messageOf(t.owner.id, msg.id);
    expect(asOwner.attachments).toHaveLength(1);
    await loginAs(t.owner.id);
    expect((await call(attachmentRoute.GET, { url: `http://localhost/api/chat/attachments/${att.id}`, params: { id: att.id } })).status).toBe(200);
  });

  it("before the delete, the same photo is served to the space (the fix closes only the deleted case)", async () => {
    const { msg, att } = await messageWithPhoto(t.member.id);
    expect((await messageOf(t.guest.id, msg.id)).attachments).toHaveLength(1);
    await loginAs(t.guest.id);
    expect((await call(attachmentRoute.GET, { url: `http://localhost/api/chat/attachments/${att.id}`, params: { id: att.id } })).status).toBe(200);
  });
});

describe("chat: the bell never keeps the words of a deleted or edited message", () => {
  async function dmMessage(text: string) {
    await loginAs(t.member.id);
    const dm = await call(conversationsRoute.POST, { body: { kind: "DM", userId: t.admin.id } });
    const dmId = dm.json?.["id"] as string;
    const sent = await call(conversationMessagesRoute.POST, { params: { id: dmId }, body: { body: text } });
    expect(sent.status).toBe(201);
    return { dmId, messageId: sent.json?.["id"] as string };
  }
  const bellOf = (userId: string) => db.notification.findMany({ where: { userId, type: "chat_message" }, select: { body: true, linkUrl: true } });

  it("delete: the admin's notification keeps «حُذفت الرسالة», never the text", async () => {
    const secret = `deleted secret ${uid()}`;
    const { dmId, messageId } = await dmMessage(secret);
    const before = await bellOf(t.admin.id);
    expect(before.some((n) => n.body === secret && n.linkUrl === `/chat/${dmId}?m=${messageId}`)).toBe(true);

    await loginAs(t.member.id);
    expect((await call(messageRoute.DELETE, { method: "DELETE", params: { id: messageId } })).status).toBeLessThan(300);
    const after = await bellOf(t.admin.id);
    expect(after.some((n) => n.body?.includes(secret))).toBe(false);
    expect(after.some((n) => n.body === "حُذفت الرسالة")).toBe(true);
  });

  it("edit: the notification shows the edited words, not the first ones", async () => {
    const first = `first words ${uid()}`;
    const { messageId } = await dmMessage(first);
    await loginAs(t.member.id);
    const edited = await call(messageRoute.PATCH, { method: "PATCH", params: { id: messageId }, body: { body: "second words" } });
    expect(edited.status).toBe(200);
    const bell = await bellOf(t.admin.id);
    expect(bell.some((n) => n.body?.includes(first))).toBe(false);
    expect(bell.some((n) => n.body === "second words")).toBe(true);
  });
});
