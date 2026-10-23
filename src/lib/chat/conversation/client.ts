import type { FileKind } from "@/lib/chat/file-kinds";

export function conversationDetailUrl(id: string, before?: string): string {
  const query = new URLSearchParams({ limit: "40" });
  if (before) query.set("before", before);
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
}

export function buildChatMessagePayload(input: ChatMessagePayloadInput) {
  return {
    body: input.body.trim(),
    attachmentIds: input.attachmentIds,
    mentions: input.mentions,
    ...(input.replyToId ? { replyToId: input.replyToId } : {}),
    clientId: input.clientId,
  };
}

export function messageClientId(): string {
  return globalThis.crypto.randomUUID();
}
