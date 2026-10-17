import { createHash } from "node:crypto";

export const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB per file

/**
 * Sniff the REAL type from magic bytes. The client's claimed type/extension is
 * never trusted. This decides preview safety and whether an upload is allowed
 * at all. Returns null for unknown or dangerous payloads.
 */
export function sniffMimeType(rawBytes: Uint8Array | number[]): string | null {
  const bytes = rawBytes instanceof Uint8Array ? rawBytes : Uint8Array.from(rawBytes);
  if (bytes.length < 4) return null;

  const at = (i: number) => bytes[i] ?? -1;
  const u32 = readU32(bytes, 0);
  const riff = ascii(bytes, 0, 4);

  // images
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return "image/png";
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "image/jpeg";
  if (u32 === 0x47494638) return "image/gif"; // "GIF8"
  if (riff === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "image/webp";

  // motion + audio
  if (ascii(bytes, 4, 4) === "ftyp") return "video/mp4"; // MP4/MOV family
  if (u32 === 0x1a45dfa3) return "video/webm"; // EBML (webm/mkv)
  if (riff === "RIFF" && ascii(bytes, 8, 4) === "WAVE") return "audio/wav";
  if (at(0) === 0x49 && at(1) === 0x44 && at(2) === 0x33) return "audio/mpeg"; // "ID3"
  if (at(0) === 0xff && (at(1) & 0xe0) === 0xe0 && at(1) !== 0xff && at(2) !== 0xff) return "audio/mpeg";
  if (u32 === 0x4f676753) return "audio/ogg"; // "OggS"

  // documents/archives
  if (ascii(bytes, 0, 4) === "%PDF") return "application/pdf";
  if (u32 === 0x504b0304 || u32 === 0x504b0506 || u32 === 0x504b0708) return "application/zip"; // zip family: archive, docx, xlsx, pptx, odt

  // plain text (utf-8) without control garbage in the first 512 bytes
  const probe = bytes.subarray(0, Math.min(512, bytes.length));
  let printable = 0;
  for (const b of probe) {
    if (b === 0x09 || b === 0x0d || b === 0x0a) printable += 1;
    else if (b >= 0x20 && b !== 0x7f) printable += 1;
  }
  if (printable === probe.length) return "text/plain";
  return null;
}

function readU32(b: Uint8Array, off: number): number {
  const n =
    (b[off] ?? 0) * 2 ** 24 + (b[off + 1] ?? 0) * 2 ** 16 + (b[off + 2] ?? 0) * 2 ** 8 + (b[off + 3] ?? 0);
  return n >>> 0;
}

function ascii(b: Uint8Array, off: number, len: number): string {
  if (b.length < off + len) return "";
  return String.fromCharCode(...b.subarray(off, off + len));
}

export function checksumHex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 32);
}

/** Rewrite a client filename into something safe to store on Windows disk. */
export function safeStoredName(original: string): string {
  const cleaned = original
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/^\.+/, "") // no traversal starts, no hidden dotfiles
    .trim();
  const name = cleaned.length > 0 ? cleaned : "file";
  return name.slice(0, 120);
}

/** Pure policy: who may manage (delete) a stored file. */
export function canManageFile(input: { uploaderId: string; viewerId: string; orgRole: string }): boolean {
  if (input.orgRole === "GUEST") return false;
  return input.uploaderId === input.viewerId || input.orgRole === "OWNER" || input.orgRole === "ADMIN";
}
