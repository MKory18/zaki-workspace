import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// the components are TSX; under vitest their JSX compiles to React.createElement (global React)
(globalThis as { React?: typeof React }).React = React;

import { I18nProvider } from "@/lib/i18n";
import { ChatComposer } from "@/components/chat/composer/chat-composer";
import { MessageItem } from "@/components/chat/message/message-item";
import { VoicePlayer } from "@/components/chat/message/voice-player";
import { buildChatMessagePayload, createVoiceUploadFormData } from "@/lib/chat/conversation/client";
import { uploadWithProgress } from "@/lib/chat/upload-with-progress";
import type { ConversationDto, MessageDto } from "@/server/chat/dto";

const withI18n = (el: React.ReactElement) =>
  renderToStaticMarkup(React.createElement(I18nProvider as unknown as React.FC<{ initial: "ar"; children?: React.ReactNode }>, { initial: "ar" }, el));

const detail = { id: "c1", kind: "TOPIC", title: "t", emoji: null, closed: false, me: { canPost: true, canModerate: false, muted: false, oversight: false, canJoin: false }, members: [], messages: [], readers: [] } as unknown as ConversationDto;

describe("the composer", () => {
  it("an empty box shows the «+» menu in the corner and the microphone in place of «إرسال»", () => {
    const html = withI18n(React.createElement(ChatComposer, { conversationId: "c1", detail, reply: null, onMessage: () => undefined, onCancelReply: () => undefined }));
    expect(html).toContain('aria-label="إرفاق"');
    expect(html).toContain('aria-label="تسجيل رسالة صوتية"');
    expect(html).not.toContain('aria-label="إرسال"');
    // the picker for the gallery and the camera, and the one for any file
    expect(html).toContain('accept="image/*,video/*"');
    // the old «إرفاق ملفات» line is gone
    expect(html).not.toContain("إرفاق ملفات");
  });
});

describe("the voice upload and send", () => {
  it("the upload form carries the take, its kind, its length and its waveform", () => {
    const form = createVoiceUploadFormData({ blob: new Blob(["x"], { type: "audio/webm" }), mime: "audio/webm", durationMs: 4200.4, peaks: [1, 50, 99] });
    expect(form.get("kind")).toBe("VOICE");
    expect(form.get("durationMs")).toBe("4200");
    expect(form.get("peaks")).toBe("[1,50,99]");
    expect((form.get("file") as File).name).toBe("voice.webm");
    const safari = createVoiceUploadFormData({ blob: new Blob(["x"]), mime: "audio/mp4", durationMs: 1, peaks: [] });
    expect((safari.get("file") as File).name).toBe("voice.m4a");
  });

  it("the message says voice: true only for a voice note", () => {
    expect(buildChatMessagePayload({ body: "", attachmentIds: ["f1"], mentions: [], clientId: "c", voice: true })).toMatchObject({ voice: true });
    expect(buildChatMessagePayload({ body: "hi", attachmentIds: [], mentions: [], clientId: "c" })).not.toHaveProperty("voice");
  });

  it("uploads report their progress and hand back the server's error key", async () => {
    const listeners: { progress?: (e: { lengthComputable: boolean; loaded: number; total: number }) => void } = {};
    const fake = (status: number, body: unknown) => () => {
      const xhr = {
        upload: {} as { onprogress?: (e: { lengthComputable: boolean; loaded: number; total: number }) => void },
        status,
        responseText: JSON.stringify(body),
        open: vi.fn(),
        onload: null as null | (() => void),
        onerror: null as null | (() => void),
        send() {
          listeners.progress = xhr.upload.onprogress;
          xhr.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 200 });
          xhr.onload?.();
        },
      };
      return xhr as unknown as XMLHttpRequest;
    };
    const seen: number[] = [];
    await expect(uploadWithProgress("/u", new FormData(), (p) => seen.push(p), fake(201, { id: "f1" }))).resolves.toEqual({ id: "f1" });
    expect(seen).toEqual([25, 100]);
    await expect(uploadWithProgress("/u", new FormData(), () => undefined, fake(403, { error: "forbidden", message: "chat.f.too_large" }))).rejects.toThrow("chat.f.too_large");
    await expect(uploadWithProgress("/u", new FormData(), () => undefined, fake(500, { error: "internal" }))).rejects.toThrow("chat.f.upload_failed");
  });
});

describe("the voice note in a bubble", () => {
  it("plays from a button, draws its waveform and says its length", () => {
    const html = renderToStaticMarkup(React.createElement(VoicePlayer, { src: "/api/chat/attachments/a1", peaks: [10, 90, 40], durationMs: 3000 }));
    expect(html).toContain("<audio");
    expect(html).toContain('aria-label="تشغيل"');
    expect(html).toContain("0:03");
    expect((html.match(/rounded-full bg-/g) ?? []).length).toBeGreaterThanOrEqual(32);
  });

  it("a VOICE message shows the player, not a download link; an ordinary audio file keeps its link", () => {
    const att = { id: "a1", kind: "AUDIO" as const, name: "voice.webm", mime: "audio/webm", size: 10, url: "/api/chat/attachments/a1", durationMs: 2000, peaks: [5, 50] };
    const base: MessageDto = { id: "m1", kind: "VOICE", body: null, deleted: false, edited: false, pinned: false, mine: false, authorId: "u1", authorName: "ليلى", createdAt: "2026-01-01T00:00:00Z", mentions: [], attachments: [att], reactions: [] };
    const noop = () => undefined;
    const props = { canModerate: false, onReply: noop, onReact: noop, onPin: noop, onEdit: noop, onDelete: noop };
    const voice = renderToStaticMarkup(React.createElement(MessageItem, { ...props, message: base }));
    expect(voice).toContain("data-voice");
    expect(voice).not.toContain("تنزيل voice.webm");
    const file = renderToStaticMarkup(React.createElement(MessageItem, { ...props, message: { ...base, kind: "TEXT", body: "اسمع" } }));
    expect(file).not.toContain("data-voice");
    expect(file).toContain("تنزيل voice.webm");
  });
});
