/**
 * Classifying a picked `File` (FILES-VOICE): the composer needs to know BEFORE the upload
 * whether it picked an image (compress first), a video, an audio note or a plain file, and
 * which per-kind limit applies. The browser's mime/extension is trusted here ONLY for the
 * picker's UX; the server re-decides from the bytes and refuses a mismatch.
 */
export type FileKind = "IMAGE" | "VIDEO" | "AUDIO" | "FILE";

/** Must stay aligned with MAX_ATTACHMENTS_PER_MESSAGE on the server. */
export const MAX_ATTACHMENTS_PER_MESSAGE = 10;

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|heic|heif|avif)$/i;
const VIDEO_EXT = /\.(mp4|webm|mov|m4v|mkv)$/i;
const AUDIO_EXT = /\.(mp3|wav|ogg|oga|m4a|webm|opus|aac)$/i;

export function classifyFile(file: { type?: string; name: string }): FileKind {
  const type = (file.type ?? "").toLowerCase();
  const name = file.name.toLowerCase();
  if (type.startsWith("image/")) return "IMAGE";
  if (type.startsWith("video/")) return "VIDEO";
  if (type.startsWith("audio/")) return "AUDIO";
  if (IMAGE_EXT.test(name)) return "IMAGE";
  if (VIDEO_EXT.test(name)) return "VIDEO";
  if (AUDIO_EXT.test(name)) return "AUDIO";
  return "FILE";
}

/** Per-kind limit in bytes — mirrors the server's CHAT_LIMITS. */
export const KIND_LIMIT_BYTES: Record<FileKind, number> = {
  IMAGE: 15 * 1024 * 1024,
  VIDEO: 100 * 1024 * 1024,
  AUDIO: 10 * 1024 * 1024,
  FILE: 25 * 1024 * 1024,
};

/** True when this file is bigger than its kind allows (the UI disables the send button). */
export function exceedsKindLimit(size: number, kind: FileKind): boolean {
  return size > KIND_LIMIT_BYTES[kind];
}
