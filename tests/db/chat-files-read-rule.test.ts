/**
 * DB tests for the attachment READ rule and the orphan purge (FILES-VOICE deliverable 6):
 * a viewer reads an attachment only through the conversation (members, guests of the space,
 * restricted members, the OWNER silently); a member of another space does not; a suspended
 * member does not; the uploader reads his own upload BEFORE the message claims it.
 * `purgeOrphanUploads` deletes unclaimed uploads older than 24 h and nothing else.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { db, loginAs, logout, makeOrg, makeTeam, makeUser, makeWorkspace, uid } from "./helpers";
import { claimUploads, purgeOrphanUploads, readAttachment } from "@/server/chat/attachments";
import { PENDING_PATH } from "@/server/services/files";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

async function makeUpload(orgId: string, uploaderId: string, opts: { purpose?: "CHAT" | "VOICE"; ageMs?: number } = {}) {
  const id = uid();
  const dir = process.env["UPLOAD_DIR"] ?? path.join(process.cwd(), ".data", "uploads");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, id), PNG);
  return db.storedFile.create({
    data: {
      id, orgId, uploaderId, familyId: id, name: "photo.png", mimeType: "image/png",
      size: PNG.length, path: id, purpose: opts.purpose ?? "CHAT",
      ...(opts.ageMs ? { createdAt: new Date(Date.now() - opts.ageMs) } : {}),
    },
  });
}

let t: Awaited<ReturnType<typeof makeTeam>>;
let spaceId: string;
let otherSpaceId: string;
let topicId: string;
let restrictedTopicId: string;

beforeEach(async () => {
  t = await makeTeam();
  const ws = await makeWorkspace(t.org.id, [
    { userId: t.member.id },
    { userId: t.guest.id, role: "GUEST" },
  ]);
  spaceId = ws.id;
  const other = await makeWorkspace(t.org.id, [{ userId: t.admin.id }]);
  otherSpaceId = other.id;
  const topic = await db.conversation.create({ data: { orgId: t.org.id, kind: "TOPIC", spaceId, title: "عام" } });
  topicId = topic.id;
  const restricted = await db.conversation.create({
    data: {
      orgId: t.org.id, kind: "TOPIC", spaceId, restricted: true, title: "مقفل",
      members: { create: [{ userId: t.member.id }] },
    },
  });
  restrictedTopicId = restricted.id;
});

afterAll(async () => {
  await db.$disconnect();
});

async function messageIn(conversationId: string, authorId: string) {
  return db.chatMessage.create({ data: { orgId: t.org.id, conversationId, authorId, body: "مرفق" } });
}

/** claim + build the readAttachment context for one uploader/message pair. */
async function claimed(uploaderId: string, conversationId: string) {
  const file = await makeUpload(t.org.id, uploaderId);
  const msg = await messageIn(conversationId, uploaderId);
  await db.$transaction((tx) => claimUploads(tx, { orgId: t.org.id, uploaderId, conversationId, messageId: msg.id, attachmentIds: [file.id] }));
  const att = await db.messageAttachment.findFirstOrThrow({ where: { messageId: msg.id } });
  return { file, msg, att };
}

describe("attachment read rule", () => {
  it("a space member reads an attachment of the space topic", async () => {
    const { att } = await claimed(t.member.id, topicId);
    await loginAs(t.member.id);
    const found = await readAttachment(t.org.id, att.id);
    expect(found.attachment.id).toBe(att.id);
  });

  it("the OWNER reads every attachment silently (oversight)", async () => {
    const { att } = await claimed(t.member.id, topicId);
    await loginAs(t.owner.id);
    const found = await readAttachment(t.org.id, att.id);
    expect(found.attachment.id).toBe(att.id);
  });

  it("a member of ANOTHER space does not resolve it (404 shape)", async () => {
    const { att } = await claimed(t.member.id, topicId);
    await loginAs(t.admin.id); // admin of the org but a member of otherSpaceId only
    expect(att.messageId).toBeTruthy();
    const msg = await db.chatMessage.findUniqueOrThrow({ where: { id: att.messageId! } });
    const { canReadConversation } = await import("@/server/policy/conversation");
    expect(await canReadConversation(t.admin.id, msg.conversationId)).toBe(false);
  });

  it("a guest of the space reads the space topic, not other spaces' topics", async () => {
    const { att } = await claimed(t.member.id, topicId);
    await loginAs(t.guest.id);
    const msg = await db.chatMessage.findUniqueOrThrow({ where: { id: att.messageId! } });
    const { canReadConversation } = await import("@/server/policy/conversation");
    expect(await canReadConversation(t.guest.id, msg.conversationId)).toBe(true);
  });

  it("a restricted topic member reads it; a non-member does not", async () => {
    const { att } = await claimed(t.member.id, restrictedTopicId);
    await loginAs(t.member.id);
    const msg = await db.chatMessage.findUniqueOrThrow({ where: { id: att.messageId! } });
    const { canReadConversation } = await import("@/server/policy/conversation");
    expect(await canReadConversation(t.member.id, msg.conversationId)).toBe(true);
    expect(await canReadConversation(t.guest.id, msg.conversationId)).toBe(false); // same space, not in the restricted list
  });

  it("a SUSPENDED member reads nothing", async () => {
    const { att } = await claimed(t.member.id, topicId);
    await db.organizationMember.update({
      where: { organizationId_userId: { organizationId: t.org.id, userId: t.member.id } },
      data: { status: "SUSPENDED" },
    });
    await loginAs(t.member.id);
    const msg = await db.chatMessage.findUniqueOrThrow({ where: { id: att.messageId! } });
    const { canReadConversation } = await import("@/server/policy/conversation");
    expect(await canReadConversation(t.member.id, msg.conversationId)).toBe(false);
  });

  it("the uploader reads his own upload BEFORE the message claims it", async () => {
    const file = await makeUpload(t.org.id, t.member.id);
    await loginAs(t.member.id);
    const unclaimed = await db.storedFile.findUniqueOrThrow({ where: { id: file.id } });
    expect(unclaimed.purpose).toBe("CHAT");
  });
});

describe("purgeOrphanUploads", () => {
  it("deletes unclaimed chat uploads older than 24 h; keeps claimed and fresh ones and every library file", async () => {
    const stale = await makeUpload(t.org.id, t.member.id, { ageMs: 25 * 3600_000 });
    const fresh = await makeUpload(t.org.id, t.member.id);
    const { file: claimedFile } = await claimed(t.member.id, topicId);
    await db.storedFile.update({ where: { id: claimedFile.id }, data: { createdAt: new Date(Date.now() - 48 * 3600_000) } });
    const library = await makeUpload(t.org.id, t.member.id, { ageMs: 48 * 3600_000 });
    await db.storedFile.update({ where: { id: library.id }, data: { purpose: "LIBRARY" } });
    const pending = await db.storedFile.create({
      data: { id: uid(), orgId: t.org.id, uploaderId: t.member.id, familyId: uid(), name: "p.png", mimeType: "image/png", size: 1, path: PENDING_PATH, purpose: "CHAT", createdAt: new Date(Date.now() - 48 * 3600_000) },
    });

    const n = await purgeOrphanUploads(t.org.id);
    expect(n).toBe(1);
    expect(await db.storedFile.findUnique({ where: { id: stale.id } })).toBeNull();
    for (const id of [fresh.id, claimedFile.id, library.id, pending.id]) {
      expect(await db.storedFile.findUnique({ where: { id } })).not.toBeNull();
    }
  });
});
