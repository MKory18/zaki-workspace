/**
 * DB tests for the FILES-VOICE claim lifecycle (deliverable 6):
 * an upload binds to the uploader only; the message claims it afterwards, in the message's
 * transaction, with the attachment facts copied from the upload meta onto MessageAttachment.
 * Someone else's file id, a foreign org's id, a pending upload, an already-claimed file and
 * an upload older than the 24-hour claim window must all be refused.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { db, loginAs, makeTeam, uid } from "./helpers";
import { claimUploads } from "@/server/chat/attachments";
import { PENDING_PATH, readStored } from "@/server/services/files";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const MP3 = new Uint8Array([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0, 9, 9]);

/** A chat upload row the way `createChatUpload` leaves it: bytes on disk, purpose CHAT/VOICE. */
async function makeUpload(orgId: string, uploaderId: string, opts: { bytes?: Uint8Array; mime?: string; purpose?: "CHAT" | "VOICE"; name?: string; meta?: Record<string, unknown> } = {}) {
  const id = uid();
  const dir = process.env["UPLOAD_DIR"] ?? path.join(process.cwd(), ".data", "uploads");
  const bytes = opts.bytes ?? PNG;
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, id), bytes);
  const file = await db.storedFile.create({
    data: {
      id,
      orgId,
      uploaderId,
      familyId: id,
      name: opts.name ?? "photo.png",
      mimeType: opts.mime ?? "image/png",
      size: bytes.length,
      path: id,
      purpose: opts.purpose ?? "CHAT",
    },
  });
  if (opts.meta && Object.keys(opts.meta).length > 0) {
    await db.$executeRaw`UPDATE "StoredFile" SET meta = ${JSON.stringify(opts.meta)}::jsonb WHERE id = ${id}`;
  }
  return file;
}

let t: Awaited<ReturnType<typeof makeTeam>>;
let convId: string;

beforeEach(async () => {
  t = await makeTeam();
  const conv = await db.conversation.create({ data: { orgId: t.org.id, kind: "DM" } });
  convId = conv.id;
});

afterAll(async () => {
  await db.$disconnect();
});

async function makeMessage(authorId: string) {
  return db.chatMessage.create({
    data: { orgId: t.org.id, conversationId: convId, authorId, body: "hi" },
  });
}

describe("claimUploads", () => {
  it("binds the uploader's own pending uploads to their message, copying the meta", async () => {
    await loginAs(t.member.id);
    const file = await makeUpload(t.org.id, t.member.id, { meta: { width: 40, height: 20 } });
    const msg = await makeMessage(t.member.id);
    await db.$transaction((tx) => claimUploads(tx, { orgId: t.org.id, uploaderId: t.member.id, conversationId: convId, messageId: msg.id, attachmentIds: [file.id] }));
    const rows = await db.messageAttachment.findMany({ where: { messageId: msg.id } });
    expect(rows.length).toBe(1);
    expect(rows[0]!.fileId).toBe(file.id);
    expect(rows[0]!.kind).toBe("IMAGE");
    expect(rows[0]!.width).toBe(40);
    expect(rows[0]!.height).toBe(20);
  });

  it("binds a voice upload as AUDIO with durationMs and peaks", async () => {
    await loginAs(t.member.id);
    const file = await makeUpload(t.org.id, t.member.id, {
      purpose: "VOICE", mime: "audio/webm", name: "voice.webm", bytes: MP3,
      meta: { durationMs: 4300, peaks: [10, 50, 90, 30] },
    });
    const msg = await makeMessage(t.member.id);
    await db.$transaction((tx) => claimUploads(tx, { orgId: t.org.id, uploaderId: t.member.id, conversationId: convId, messageId: msg.id, attachmentIds: [file.id] }));
    const row = await db.messageAttachment.findFirstOrThrow({ where: { messageId: msg.id } });
    expect(row.kind).toBe("AUDIO");
    expect(row.durationMs).toBe(4300);
    expect(row.peaks).toEqual([10, 50, 90, 30]);
  });

  it("refuses a foreign uploader's id", async () => {
    await loginAs(t.member.id);
    const file = await makeUpload(t.org.id, t.guest.id);
    const msg = await makeMessage(t.member.id);
    await expect(db.$transaction((tx) => claimUploads(tx, { orgId: t.org.id, uploaderId: t.member.id, conversationId: convId, messageId: msg.id, attachmentIds: [file.id] }))).rejects.toThrow();
    expect(await db.messageAttachment.count({ where: { messageId: msg.id } })).toBe(0);
  });

  it("refuses an upload from another org", async () => {
    const other = await makeTeam();
    await loginAs(t.member.id);
    const file = await makeUpload(other.org.id, t.member.id);
    const msg = await makeMessage(t.member.id);
    await expect(db.$transaction((tx) => claimUploads(tx, { orgId: t.org.id, uploaderId: t.member.id, conversationId: convId, messageId: msg.id, attachmentIds: [file.id] }))).rejects.toThrow();
  });

  it("refuses a pending (bytes not yet on disk) upload", async () => {
    await loginAs(t.member.id);
    const pending = await db.storedFile.create({
      data: { id: uid(), orgId: t.org.id, uploaderId: t.member.id, familyId: uid(), name: "p.png", mimeType: "image/png", size: 1, path: PENDING_PATH, purpose: "CHAT" },
    });
    const msg = await makeMessage(t.member.id);
    await expect(db.$transaction((tx) => claimUploads(tx, { orgId: t.org.id, uploaderId: t.member.id, conversationId: convId, messageId: msg.id, attachmentIds: [pending.id] }))).rejects.toThrow();
  });

  it("refuses a file that is already claimed by another message", async () => {
    await loginAs(t.member.id);
    const file = await makeUpload(t.org.id, t.member.id);
    const first = await makeMessage(t.member.id);
    await db.$transaction((tx) => claimUploads(tx, { orgId: t.org.id, uploaderId: t.member.id, conversationId: convId, messageId: first.id, attachmentIds: [file.id] }));
    const second = await makeMessage(t.member.id);
    await expect(db.$transaction((tx) => claimUploads(tx, { orgId: t.org.id, uploaderId: t.member.id, conversationId: convId, messageId: second.id, attachmentIds: [file.id] }))).rejects.toThrow();
  });

  it("refuses an upload older than the 24-hour claim window", async () => {
    await loginAs(t.member.id);
    const file = await makeUpload(t.org.id, t.member.id);
    await db.storedFile.update({ where: { id: file.id }, data: { createdAt: new Date(Date.now() - 25 * 3600_000) } });
    const msg = await makeMessage(t.member.id);
    await expect(db.$transaction((tx) => claimUploads(tx, { orgId: t.org.id, uploaderId: t.member.id, conversationId: convId, messageId: msg.id, attachmentIds: [file.id] }))).rejects.toThrow();
  });

  it("refuses more than ten attachments", async () => {
    await loginAs(t.member.id);
    const files = await Promise.all(Array.from({ length: 11 }, () => makeUpload(t.org.id, t.member.id)));
    const msg = await makeMessage(t.member.id);
    await expect(db.$transaction((tx) => claimUploads(tx, { orgId: t.org.id, uploaderId: t.member.id, conversationId: convId, messageId: msg.id, attachmentIds: files.map((f) => f.id) }))).rejects.toThrow();
  });

  it("positions multiple attachments in the given order", async () => {
    await loginAs(t.member.id);
    const a = await makeUpload(t.org.id, t.member.id);
    const b = await makeUpload(t.org.id, t.member.id);
    const msg = await makeMessage(t.member.id);
    await db.$transaction((tx) => claimUploads(tx, { orgId: t.org.id, uploaderId: t.member.id, conversationId: convId, messageId: msg.id, attachmentIds: [a.id, b.id] }));
    const rows = await db.messageAttachment.findMany({ where: { messageId: msg.id }, orderBy: { position: "asc" } });
    expect(rows.map((r) => r.fileId)).toEqual([a.id, b.id]);
  });
});
