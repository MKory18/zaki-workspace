import type { FileKind } from "@/lib/chat/file-kinds";

export function conversationDetailUrl(id: string, before?: string, around?: string): string {
  const query = new URLSearchParams({ limit: "40" });
  if (before) query.set("before", before);
  if (around) query.set("around", around);
  return `/api/chat/conversations/${encodeURIComponent(id)}?${query.toString()}`;
}

export function createChatUploadFormData(file: File, kind: FileKind): FormData {
  const form = new FormData();
  form.append("file", file);
  form.append("kind", kind);
  return form;
}

export interface ChatMessagePayloadInput {
  body: string;
  attachmentIds: string[];
  mentions: string[];
  replyToId?: string;
  clientId: string;
  /** a voice note: its one attachment is the recording (the server makes it a VOICE message) */
  voice?: boolean;
}

export function buildChatMessagePayload(input: ChatMessagePayloadInput) {
  return {
    body: input.body.trim(),
    attachmentIds: input.attachmentIds,
    mentions: input.mentions,
    ...(input.replyToId ? { replyToId: input.replyToId } : {}),
    clientId: input.clientId,
    ...(input.voice ? { voice: true } : {}),
  };
}

/** The upload form of a recording: the take, its length and its waveform (the server caps both). */
export function createVoiceUploadFormData(take: { blob: Blob; mime: string; durationMs: number; peaks: number[] }): FormData {
  const ext = take.mime.includes("mp4") ? "m4a" : take.mime.includes("ogg") ? "ogg" : "webm";
  const form = new FormData();
  form.append("file", new File([take.blob], `voice.${ext}`, { type: take.mime }));
  form.append("kind", "VOICE");
  form.append("durationMs", String(Math.round(take.durationMs)));
  form.append("peaks", JSON.stringify(take.peaks));
  return form;
}

export function messageClientId(): string {
  return globalThis.crypto.randomUUID();
}
