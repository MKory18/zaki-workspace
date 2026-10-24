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
import * as attachmentRoute from "@/app/api/chat/attachments/[id]/route";

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

/**
 * Every case goes through the real door, GET /api/chat/attachments/[id] (review C item 7: these cases
 * used to call canReadConversation and never the route, so the 404 shape and the headers were never
 * exercised). What may not be read is 404, never 403, and carries no bytes.
 */
async function fetchAttachment(id: string, headers: Record<string, string> = {}) {
  const res = await attachmentRoute.GET(new Request(`http://localhost/api/chat/attachments/${id}`, { headers }), { params: { id } });
  return { status: res.status, headers: res.headers, body: new Uint8Array(await res.arrayBuffer()) };
}

describe("attachment read rule (through the route)", () => {
  it("a space member reads an attachment of the space topic: the bytes, nosniff, inline for an image, ranges", async () => {
    const { att } = await claimed(t.member.id, topicId);
    await loginAs(t.member.id);
    const res = await fetchAttachment(att.id);
    expect(res.status).toBe(200);
    expect([...res.body]).toEqual([...PNG]);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("content-disposition")).toMatch(/^inline; filename\*=UTF-8''/);
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    const part = await fetchAttachment(att.id, { range: "bytes=0-3" });
    expect(part.status).toBe(206);
    expect([...part.body]).toEqual([...PNG.slice(0, 4)]);
  });

  it("the OWNER reads every attachment silently (oversight)", async () => {
    const { att } = await claimed(t.member.id, topicId);
    await loginAs(t.owner.id);
    expect((await fetchAttachment(att.id)).status).toBe(200);
  });

  it("a member of ANOTHER space gets 404, and no bytes", async () => {
    const { att } = await claimed(t.member.id, topicId);
    await loginAs(t.admin.id); // an org admin, but only in otherSpaceId
    const res = await fetchAttachment(att.id);
    expect(res.status).toBe(404);
    expect(res.body.length).toBe(0);
  });

  it("a guest of the space reads the space topic's attachment", async () => {
    const { att } = await claimed(t.member.id, topicId);
    await loginAs(t.guest.id);
    expect((await fetchAttachment(att.id)).status).toBe(200);
  });

  it("a restricted topic's member reads it; the space's guest, not in the list, gets 404", async () => {
    const { att } = await claimed(t.member.id, restrictedTopicId);
    await loginAs(t.member.id);
    expect((await fetchAttachment(att.id)).status).toBe(200);
    await loginAs(t.guest.id);
    expect((await fetchAttachment(att.id)).status).toBe(404);
  });

  it("a SUSPENDED member reads nothing", async () => {
    const { att } = await claimed(t.member.id, topicId);
    await loginAs(t.member.id);
    await db.organizationMember.update({
      where: { organizationId_userId: { organizationId: t.org.id, userId: t.member.id } },
      data: { status: "SUSPENDED" },
    });
    expect((await fetchAttachment(att.id)).status).not.toBe(200);
  });

  it("the uploader reads his own upload BEFORE the message claims it; nobody else does", async () => {
    const file = await makeUpload(t.org.id, t.member.id);
    await loginAs(t.member.id);
    const mine = await fetchAttachment(file.id);
    expect(mine.status).toBe(200);
    expect([...mine.body]).toEqual([...PNG]);
    await loginAs(t.owner.id);
    expect((await fetchAttachment(file.id)).status).toBe(404);
  });

  it("the file of a deleted message is gone for everybody but the OWNER", async () => {
    const { att, msg } = await claimed(t.member.id, topicId);
    await db.chatMessage.update({ where: { id: msg.id }, data: { deletedAt: new Date(), deletedById: t.member.id } });
    await loginAs(t.member.id);
    expect((await fetchAttachment(att.id)).status).toBe(404);
    await loginAs(t.owner.id);
    expect((await fetchAttachment(att.id)).status).toBe(200);
  });

  it("another company's attachment id is 404, even for an OWNER", async () => {
    const { att } = await claimed(t.member.id, topicId);
    const other = await makeTeam();
    await loginAs(other.owner.id);
    expect((await fetchAttachment(att.id)).status).toBe(404);
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
