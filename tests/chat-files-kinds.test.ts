import { describe, expect, it } from "vitest";
import { KIND_LIMIT_BYTES, classifyFile, exceedsKindLimit } from "../src/lib/chat/file-kinds";

describe("file-kind classifier (deliverable 5)", () => {
  it("classifies by mime first, then extension", () => {
    expect(classifyFile({ type: "image/png", name: "a.png" })).toBe("IMAGE");
    expect(classifyFile({ type: "video/webm", name: "a" })).toBe("VIDEO");
    expect(classifyFile({ type: "audio/ogg", name: "a" })).toBe("AUDIO");
    expect(classifyFile({ type: "application/pdf", name: "a.pdf" })).toBe("FILE");
    expect(classifyFile({ type: "", name: "IMG_0001.heic" })).toBe("IMAGE");
    expect(classifyFile({ type: "", name: "clip.MOV" })).toBe("VIDEO");
    expect(classifyFile({ type: "", name: "note.opus" })).toBe("AUDIO");
    expect(classifyFile({ type: "", name: "report.xlsx" })).toBe("FILE");
  });

  it("kind limits mirror the server", () => {
    expect(KIND_LIMIT_BYTES.IMAGE).toBe(15 * 1024 * 1024);
    expect(KIND_LIMIT_BYTES.VIDEO).toBe(100 * 1024 * 1024);
    expect(KIND_LIMIT_BYTES.AUDIO).toBe(10 * 1024 * 1024);
    expect(KIND_LIMIT_BYTES.FILE).toBe(25 * 1024 * 1024);
    expect(exceedsKindLimit(15 * 1024 * 1024 + 1, "IMAGE")).toBe(true);
    expect(exceedsKindLimit(15 * 1024 * 1024, "IMAGE")).toBe(false);
  });
});
