import { describe, expect, it } from "vitest";
import * as uploadsRoute from "@/app/api/chat/uploads/route";
import * as messagesRoute from "@/app/api/chat/conversations/[id]/messages/route";
import * as conversationRoute from "@/app/api/chat/conversations/[id]/route";
import * as dmRoute from "@/app/api/chat/dm/route";
import type { ConversationDto } from "@/server/chat/dto";
import { MAX_VOICE_MS } from "@/server/chat/attachments";
import { call, db, loginAs, makeTeam, makeWorkspace } from "./helpers";

/** The head of a real MediaRecorder take: the EBML magic, then the "webm" doc type within 48 bytes. */
const WEBM = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01, 0x42, 0xf2, 0x81, 0x04, 0x42, 0xf3, 0x81, 0x08, 0x42, 0x82, 0x84, ...Buffer.from("webm"), 0x42, 0x87, 0x81, 0x04, 0, 0, 0, 0]);

async function upload(file: { bytes: Uint8Array; name: string }, kind: string, extra: Record<string, string> = {}) {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(file.bytes)], file.name));
  form.append("kind", kind);
  for (const [k, v] of Object.entries(extra)) form.append(k, v);
  const res = await uploadsRoute.POST(new Request("http://localhost/api/chat/uploads", { method: "POST", body: form }));
  const text = await res.text();
  return { status: res.status, json: (text ? JSON.parse(text) : null) as Record<string, unknown> | null, text };
}

describe("voice messages", () => {
  it("a recording is stored as audio/webm (it used to land as video/webm) with its duration and waveform", async () => {
    const t = await makeTeam();
    await loginAs(t.member.id);
    const up = await upload({ bytes: WEBM, name: "voice.webm" }, "VOICE", { durationMs: "4200", peaks: JSON.stringify([10, 40, 90, 30]) });
    expect(up.status).toBe(201);
    expect(up.json).toMatchObject({ kind: "AUDIO", mime: "audio/webm", durationMs: 4200, peaks: [10, 40, 90, 30] });
    const row = await db.storedFile.findUniqueOrThrow({ where: { id: up.json?.["id"] as string } });
    expect(row.mimeType).toBe("audio/webm");
    expect(row.purpose).toBe("VOICE");
  });

  it("the duration a client claims is capped at 5 minutes on the server", async () => {
    const t = await makeTeam();
    await loginAs(t.member.id);
    const up = await upload({ bytes: WEBM, name: "voice.webm" }, "VOICE", { durationMs: String(MAX_VOICE_MS * 4) });
    expect(up.json?.["durationMs"]).toBe(MAX_VOICE_MS);
  });

  it("sending it with voice: true makes a VOICE message whose one attachment is AUDIO (the flag used to be dropped)", async () => {
    const t = await makeTeam();
    await loginAs(t.member.id);
    const dm = (await call(dmRoute.POST, { body: { userId: t.admin.id } })).json?.["id"] as string;
    const up = await upload({ bytes: WEBM, name: "voice.webm" }, "VOICE", { durationMs: "3000", peaks: "[5,50,95]" });
    const sent = await call(messagesRoute.POST, { params: { id: dm }, body: { voice: true, attachmentIds: [up.json?.["id"]] } });
    expect(sent.status).toBeLessThan(300);
    expect(sent.json?.["kind"]).toBe("VOICE");
    // the answer itself carries the audio: the sender's screen draws the message from it
    expect((sent.json?.["attachments"] as unknown[] | undefined)?.[0]).toMatchObject({ kind: "AUDIO", mime: "audio/webm", durationMs: 3000 });

    await loginAs(t.admin.id);
    const seen = (await call(conversationRoute.GET, { url: `http://localhost/api/chat/conversations/${dm}`, params: { id: dm } })).json as unknown as ConversationDto;
    const msg = seen.messages.find((m) => m.id === sent.json?.["id"]);
    expect(msg?.kind).toBe("VOICE");
    expect(msg?.attachments[0]).toMatchObject({ kind: "AUDIO", mime: "audio/webm", durationMs: 3000, peaks: [5, 50, 95] });
  });

  it("voice: true with no audio is refused, so a voice note is never an ordinary file", async () => {
    const t = await makeTeam();
    await loginAs(t.member.id);
    const dm = (await call(dmRoute.POST, { body: { userId: t.admin.id } })).json?.["id"] as string;
    const png = await upload({ bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]), name: "p.png" }, "IMAGE");
    const sent = await call(messagesRoute.POST, { params: { id: dm }, body: { voice: true, attachmentIds: [png.json?.["id"]] } });
    expect(sent.status).toBe(422);
    expect(sent.text).toContain("chat.e.voice_needs_one_audio");
  });

  it("a guest records in the topic of their space (chat uploads), but still never fills the library", async () => {
    const t = await makeTeam();
    const ws = await makeWorkspace(t.org.id, [{ userId: t.guest.id, role: "GUEST" }]);
    const topic = await db.conversation.create({ data: { orgId: t.org.id, kind: "TOPIC", spaceId: ws.id, title: "General" } });
    await loginAs(t.guest.id);
    const up = await upload({ bytes: WEBM, name: "voice.webm" }, "VOICE", { durationMs: "2000" });
    expect(up.status).toBe(201);
    const sent = await call(messagesRoute.POST, { params: { id: topic.id }, body: { voice: true, attachmentIds: [up.json?.["id"]] } });
    expect(sent.status).toBeLessThan(300);
    expect(sent.json?.["kind"]).toBe("VOICE");

    const { ingest } = await import("@/server/services/files");
    await expect(ingest({ orgId: t.org.id, userId: t.guest.id, orgRole: "GUEST" } as never, { name: "a.txt", bytes: new TextEncoder().encode("hello") })).rejects.toThrow();
  });
});
