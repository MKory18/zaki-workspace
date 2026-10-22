import { describe, expect, it } from "vitest";
import { parseByteRange } from "../src/server/files/range";

describe("parseByteRange", () => {
  it("serves everything when there is no usable Range header", () => {
    expect(parseByteRange(null, 100)).toEqual({ kind: "none" });
    expect(parseByteRange("", 100)).toEqual({ kind: "none" });
    expect(parseByteRange("items=0-5", 100)).toEqual({ kind: "none" });
    expect(parseByteRange("bytes=0-5,10-20", 100)).toEqual({ kind: "none" }); // several ranges: whole file
    expect(parseByteRange("bytes=abc", 100)).toEqual({ kind: "none" });
    expect(parseByteRange("bytes=-", 100)).toEqual({ kind: "none" });
    expect(parseByteRange("bytes=9-3", 100)).toEqual({ kind: "none" }); // start after end: ignore
  });

  it("parses closed, open-ended and suffix ranges", () => {
    expect(parseByteRange("bytes=0-9", 100)).toEqual({ kind: "partial", start: 0, end: 9 });
    expect(parseByteRange("bytes=90-", 100)).toEqual({ kind: "partial", start: 90, end: 99 });
    expect(parseByteRange("bytes=-10", 100)).toEqual({ kind: "partial", start: 90, end: 99 });
    expect(parseByteRange("bytes=-500", 100)).toEqual({ kind: "partial", start: 0, end: 99 });
  });

  it("clamps the end to the file size", () => {
    expect(parseByteRange("bytes=50-5000", 100)).toEqual({ kind: "partial", start: 50, end: 99 });
  });

  it("is unsatisfiable when the start is past the end of the file", () => {
    expect(parseByteRange("bytes=100-", 100)).toEqual({ kind: "unsatisfiable" });
    expect(parseByteRange("bytes=500-600", 100)).toEqual({ kind: "unsatisfiable" });
    expect(parseByteRange("bytes=-0", 100)).toEqual({ kind: "unsatisfiable" });
    expect(parseByteRange("bytes=0-5", 0)).toEqual({ kind: "unsatisfiable" });
  });
});
