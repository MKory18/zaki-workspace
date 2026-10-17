import { describe, expect, it } from "vitest";
import {
  MAX_FILE_BYTES,
  canManageFile,
  safeStoredName,
  sniffMimeType,
} from "../src/server/files/sniff";

describe("magic-byte sniffing (client lies, bytes don't)", () => {
  it("recognizes images by their signatures", () => {
    expect(sniffMimeType([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a])).toBe("image/png");
    expect(sniffMimeType([0xff, 0xd8, 0xff, 0xe0])).toBe("image/jpeg");
    expect(sniffMimeType([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])).toBe("image/gif");
    expect(sniffMimeType([0x47, 0x49, 0x46])).toBeNull(); // too short to trust
  });

  it("never trusts the filename — an .exe renamed to .png is rejected", () => {
    const exe = Uint8Array.from(new Array(64).fill(0));
    exe[0] = 0x4d;
    exe[1] = 0x5a; // MZ header
    expect(sniffMimeType(exe)).toBeNull();
  });

  it("script payloads hidden in text form stay plain text — preview safe, never code", () => {
    const html = [..."<script>alert(1)</script>"].map((c) => c.charCodeAt(0));
    expect(sniffMimeType(Uint8Array.from(html))).toBe("text/plain");
  });

  it("accepts zip family (archive/docx/xlsx) and pdf", () => {
    expect(sniffMimeType([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00])).toBe("application/zip");
    expect(sniffMimeType(new TextEncoder().encode("%PDF-1.7 fake"))).toBe("application/pdf");
  });

  it("mp4 and webm by container tags", () => {
    const mp4 = [0, 0, 0, 0, ..."ftyp"].map((c) => (typeof c === "number" ? c : c.charCodeAt(0)));
    expect(sniffMimeType(Uint8Array.from(mp4))).toBe("video/mp4");
    expect(sniffMimeType([0x1a, 0x45, 0xdf, 0xa3])).toBe("video/webm");
  });

  it("binary garbage is rejected outright", () => {
    expect(sniffMimeType(Uint8Array.from([0x00, 0x01, 0x02, 0x03, 0xfe, 0xff, 0x00]))).toBeNull();
    expect(sniffMimeType(Uint8Array.from([0x01]))).toBeNull();
  });
});

describe("library policy", () => {
  it("size cap is 25 MB", () => {
    expect(MAX_FILE_BYTES).toBe(25 * 1024 * 1024);
  });

  it("uploader and org OWNER/ADMIN may manage; guests and plain members may not", () => {
    expect(canManageFile({ uploaderId: "u", viewerId: "u", orgRole: "MEMBER" })).toBe(true);
    expect(canManageFile({ uploaderId: "hol", viewerId: "admin", orgRole: "ADMIN" })).toBe(true);
    expect(canManageFile({ uploaderId: "u", viewerId: "v", orgRole: "OWNER" })).toBe(true);
    expect(canManageFile({ uploaderId: "u", viewerId: "v", orgRole: "MEMBER" })).toBe(false);
    expect(canManageFile({ uploaderId: "v", viewerId: "v", orgRole: "GUEST" })).toBe(false);
  });

  it("stored names are filesystem-safe regardless of the original path", () => {
    const out = safeStoredName([...Array(5)].map(() => "..").join("/") + "/etc/passwd");
    expect(out.includes("/")).toBe(false);
    expect(out.startsWith(".")).toBe(false);
    expect(safeStoredName("final: report?.png")).toBe("final_ report_.png");
    expect(safeStoredName("      ")).toBe("file");
  });
});
