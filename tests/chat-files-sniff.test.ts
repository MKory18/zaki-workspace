import { describe, expect, it } from "vitest";
import { CHAT_LIMITS, kindOfMime, sniffChatMedia } from "../src/server/files/sniff";

/**
 * Chat media sniffing (FILES-VOICE, deliverable 4): the bytes decide, the client's claim
 * only refines the container family. Renamed executables, HEIC photos and SVG stay out.
 */

function mp4(brand: string): Uint8Array {
  const bytes = new Uint8Array(32);
  bytes.set([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]); // ...ftyp
  for (let i = 0; i < 4; i++) bytes[8 + i] = brand.charCodeAt(i);
  return bytes;
}

const EBML = Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, ...[..."webm"].map((c) => c.charCodeAt(0)), 0, 1, 2, 3]);
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const GIF = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 2]);
const MP3 = Uint8Array.from([0x49, 0x44, 0x33, 3, 0, 0, 0, 0]);
const WAV = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45, 0x66, 0x6d, 0x74, 0x20]);
const OGG = Uint8Array.from([0x4f, 0x67, 0x67, 0x53, 1, 2, 3, 4]);
const EXE = Uint8Array.from([0x4d, 0x5a, 0x90, 0x00, 1, 2, 3, 4]);

describe("chat media sniffing — the bytes decide", () => {
  it("plain audio and video keep their mimes", () => {
    expect(sniffChatMedia(MP3, "AUDIO", "note.mp3")).toMatchObject({ ok: true, mime: "audio/mpeg", kind: "AUDIO" });
    expect(sniffChatMedia(WAV, "AUDIO", "note.wav")).toMatchObject({ ok: true, mime: "audio/wav" });
    expect(sniffChatMedia(OGG, "AUDIO", "note.ogg")).toMatchObject({ ok: true, mime: "audio/ogg" });
    expect(sniffChatMedia(mp4("isom"), "VIDEO", "clip.mp4")).toMatchObject({ ok: true, mime: "video/mp4", kind: "VIDEO" });
  });

  it("declared AUDIO/VOICE turns the MP4 family into audio/mp4 only for audio brands", () => {
    expect(sniffChatMedia(mp4("M4A "), "VOICE", "voice.m4a")).toMatchObject({ ok: true, mime: "audio/mp4", kind: "AUDIO" });
    expect(sniffChatMedia(mp4("mp42"), "VOICE", "voice.mp4")).toMatchObject({ ok: true, mime: "audio/mp4" });
    // a real video brand cannot pass as a voice note (the design accepts M4A/isom/mp42 as audio containers)
    expect(sniffChatMedia(mp4("mp71"), "VOICE", "voice.mp4")).toMatchObject({ ok: false, key: "chat.f.kind_mismatch" });
  });

  it("declared AUDIO/VOICE turns the EBML family into audio/webm only for webm containers", () => {
    expect(sniffChatMedia(EBML, "VOICE", "voice.webm")).toMatchObject({ ok: true, mime: "audio/webm", kind: "AUDIO" });
    // an mkv (EBML but not webm) is not an audio container
    const mkv = Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0x42, 0x82, 0x88, 0x6d, 0x61, 0x74, 0x72, 0x6f, 0x73, 0x6b, 0x61]);
    expect(sniffChatMedia(mkv, "AUDIO", "movie.mkv")).toMatchObject({ ok: false, key: "chat.f.kind_mismatch" });
  });

  it("a voice note that is not audio at all is refused", () => {
    expect(sniffChatMedia(PNG, "VOICE", "voice.png")).toMatchObject({ ok: false, key: "chat.f.kind_mismatch" });
    expect(sniffChatMedia(EXE, "FILE", "setup.exe")).toMatchObject({ ok: false, key: "chat.f.unsupported" });
  });

  it("an executable renamed .jpg is refused, a real jpeg passes", () => {
    expect(sniffChatMedia(EXE, "IMAGE", "photo.jpg")).toMatchObject({ ok: false, key: "chat.f.unsupported" });
    expect(sniffChatMedia(JPEG, "IMAGE", "photo.jpg")).toMatchObject({ ok: true, mime: "image/jpeg", kind: "IMAGE" });
  });

  it("HEIC/HEIF/AVIF still images are refused with a clear message (the client converts them)", () => {
    for (const brand of ["heic", "mif1", "avif"]) {
      expect(sniffChatMedia(mp4(brand), "IMAGE", `photo.${brand}`)).toMatchObject({ ok: false, key: "chat.f.heic" });
    }
  });

  it("SVG stays refused no matter how it arrives", () => {
    const svg = new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'></svg>");
    expect(sniffChatMedia(svg, "FILE", "logo.svg")).toMatchObject({ ok: false, key: "chat.f.unsupported" });
    expect(sniffChatMedia(svg, "IMAGE", "logo.svg")).toMatchObject({ ok: false, key: "chat.f.unsupported" });
  });

  it("a kind claim that disagrees with the bytes is refused (image sent as FILE etc.)", () => {
    expect(sniffChatMedia(PNG, "VIDEO", "x.png")).toMatchObject({ ok: false, key: "chat.f.kind_mismatch" });
    expect(sniffChatMedia(PNG, "IMAGE", "x.png")).toMatchObject({ ok: true, kind: "IMAGE" });
    expect(sniffChatMedia(GIF, "IMAGE", "anim.gif")).toMatchObject({ ok: true, kind: "IMAGE" });
    // FILE accepts everything sniffable
    expect(sniffChatMedia(PNG, "FILE", "x.png")).toMatchObject({ ok: true, kind: "IMAGE" });
  });

  it("per-kind size ceilings", () => {
    expect(CHAT_LIMITS.IMAGE).toBe(15 * 1024 * 1024);
    expect(CHAT_LIMITS.VIDEO).toBe(100 * 1024 * 1024);
    expect(CHAT_LIMITS.AUDIO).toBe(10 * 1024 * 1024);
    expect(CHAT_LIMITS.VOICE).toBe(10 * 1024 * 1024);
    expect(CHAT_LIMITS.FILE).toBe(25 * 1024 * 1024);
  });

  it("kindOfMime maps the stored mime", () => {
    expect(kindOfMime("image/png")).toBe("IMAGE");
    expect(kindOfMime("audio/webm")).toBe("AUDIO");
    expect(kindOfMime("video/mp4")).toBe("VIDEO");
    expect(kindOfMime("application/pdf")).toBe("FILE");
  });
});
