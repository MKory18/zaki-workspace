/**
 * The library routes (/api/files/[id], /raw, /versions) used to look a file up by id and org only,
 * so any non-guest of the company who knew the id of a chat photo or a voice note could open it
 * there, whatever conversation it was sent in. Now a CHAT/VOICE file opens there only for people
 * who may read its conversation (the OWNER silently), or for its uploader before a message claims
 * it; anybody else gets 404. Versions and delete are for LIBRARY files only.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { call, db, loginAs, makeTeam, makeUser, makeWorkspace, uid } from "./helpers";
import { claimUploads } from "@/server/chat/attachments";
import * as fileRoute from "@/app/api/files/[id]/route";
import * as rawRoute from "@/app/api/files/[id]/raw/route";
import * as versionsRoute from "@/app/api/files/[id]/versions/route";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

async function storedFile(orgId: string, uploaderId: string, purpose: "LIBRARY" | "CHAT" | "VOICE") {
  const id = uid();
  const dir = process.env["UPLOAD_DIR"] ?? path.join(process.cwd(), ".data", "uploads");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, id), PNG);
  return db.storedFile.create({
    data: { id, orgId, uploaderId, familyId: id, name: "photo.png", mimeType: "image/png", size: PNG.length, path: id, purpose },
  });
}

let t: Awaited<ReturnType<typeof makeTeam>>;
let outsider: Awaited<ReturnType<typeof makeUser>>;
let topicId: string;

beforeEach(async () => {
  t = await makeTeam();
  outsider = await makeUser({ orgId: t.org.id, role: "MEMBER", name: "Not in the space" });
  const ws = await makeWorkspace(t.org.id, [{ userId: t.member.id }]);
  const topic = await db.conversation.create({ data: { orgId: t.org.id, kind: "TOPIC", spaceId: ws.id, title: "عام" } });
  topicId = topic.id;
});

afterAll(async () => {
  await db.$disconnect();
});

/** A file sent by `t.member` in the topic (claimed by a real message). */
async function sentInTopic(purpose: "CHAT" | "VOICE" = "CHAT") {
  const file = await storedFile(t.org.id, t.member.id, purpose);
  const msg = await db.chatMessage.create({ data: { orgId: t.org.id, conversationId: topicId, authorId: t.member.id, body: "مرفق" } });
  await db.$transaction((tx) =>
    claimUploads(tx, { orgId: t.org.id, uploaderId: t.member.id, conversationId: topicId, messageId: msg.id, attachmentIds: [file.id] }),
  );
  return { file, msg };
}

const raw = (id: string) => call(rawRoute.GET, { params: { id } });
const meta = (id: string) => call(fileRoute.GET, { params: { id } });

describe("/api/files/[id] and /raw: a chat file opens only for the readers of its conversation", () => {
  it("a member who is not in the conversation gets 404 for the chat photo and the voice note, with no bytes", async () => {
    const photo = await sentInTopic("CHAT");
    const voice = await sentInTopic("VOICE");
    await loginAs(outsider.id);
    for (const { file } of [photo, voice]) {
      const r = await raw(file.id);
      expect(r.status).toBe(404);
      expect(r.text).not.toContain("PNG");
      expect((await meta(file.id)).status).toBe(404);
    }
  });

  it("an ADMIN who is not in the conversation gets 404 too", async () => {
    const { file } = await sentInTopic();
    await loginAs(t.admin.id);
    expect((await raw(file.id)).status).toBe(404);
    expect((await meta(file.id)).status).toBe(404);
  });

  it("a member of the conversation still gets 200, and so does the OWNER (silent oversight)", async () => {
    const { file } = await sentInTopic();
    for (const user of [t.member, t.owner]) {
      await loginAs(user.id);
      const r = await raw(file.id);
      expect(r.status).toBe(200);
      expect(r.headers.get("content-type")).toBe("image/png");
      const m = await meta(file.id);
      expect(m.status).toBe(200);
      expect(m.json?.["id"]).toBe(file.id);
    }
  });

  it("the file of a deleted message is gone for everybody but the OWNER", async () => {
    const { file, msg } = await sentInTopic();
    await db.chatMessage.update({ where: { id: msg.id }, data: { deletedAt: new Date() } });
    await loginAs(t.member.id);
    expect((await raw(file.id)).status).toBe(404);
    await loginAs(t.owner.id);
    expect((await raw(file.id)).status).toBe(200);
  });

  it("an unclaimed upload opens for its uploader only", async () => {
    const file = await storedFile(t.org.id, t.member.id, "CHAT");
    await loginAs(t.member.id);
    expect((await raw(file.id)).status).toBe(200);
    await loginAs(outsider.id);
    expect((await raw(file.id)).status).toBe(404);
  });

  it("a library file still opens for any member", async () => {
    const file = await storedFile(t.org.id, t.member.id, "LIBRARY");
    await loginAs(outsider.id);
    const r = await raw(file.id);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/png");
    const m = await meta(file.id);
    expect(m.status).toBe(200);
    expect(m.json?.["id"]).toBe(file.id);
  });
});

describe("versions and delete are for library files only", () => {
  it("nobody can delete a chat file through the library, not even its uploader or an ADMIN", async () => {
    const { file } = await sentInTopic();
    for (const user of [t.member, t.admin]) {
      await loginAs(user.id);
      expect((await call(fileRoute.DELETE, { method: "DELETE", params: { id: file.id } })).status).toBe(404);
    }
    expect((await db.storedFile.findUniqueOrThrow({ where: { id: file.id } })).deletedAt).toBeNull();
  });

  it("a chat file cannot anchor a new library version", async () => {
    const { file } = await sentInTopic();
    await loginAs(t.member.id);
    const res = await call(versionsRoute.POST, { method: "POST", params: { id: file.id } });
    expect(res.status).toBe(404);
    expect(await db.storedFile.count({ where: { familyId: file.familyId } })).toBe(1);
  });
});
