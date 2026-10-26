import { describe, expect, it } from "vitest";
import { fmtVideoTime, isKeyMoment, isReaction, keyMoments, momentText } from "@/lib/watch/moments";

describe("«نتفرّج سوا»: comments tied to a moment", () => {
  it("writes a second the way a video's player does", () => {
    expect(fmtVideoTime(0)).toBe("0:00");
    expect(fmtVideoTime(65.9)).toBe("1:05");
    expect(fmtVideoTime(760)).toBe("12:40");
    expect(fmtVideoTime(3723)).toBe("1:02:03");
    expect(fmtVideoTime(-4)).toBe("0:00");
    expect(fmtVideoTime(Number.NaN)).toBe("0:00");
  });

  it("a comment of one quick emoji is a reaction; anything more is not", () => {
    expect(isReaction("❤️")).toBe(true);
    expect(isReaction(" 👏 ")).toBe(true);
    expect(isReaction("❤️ حلو")).toBe(false);
    expect(isReaction("")).toBe(false);
    expect(isReaction(null)).toBe(false);
  });

  it("a comment starting with the pin is a «لحظة مهمة»", () => {
    expect(isKeyMoment("📌 هون الفكرة")).toBe(true);
    expect(isKeyMoment("📌")).toBe(true);
    expect(isKeyMoment("هون 📌")).toBe(false);
    expect(momentText("📌  هون الفكرة ")).toBe("هون الفكرة");
  });

  it("the summary is the key moments that know their second, in the video's order, deleted ones left out", () => {
    const list = [
      { id: "a", body: "📌 الثانية", videoAtSec: 90 },
      { id: "b", body: "عادي", videoAtSec: 10 },
      { id: "c", body: "📌 الأولى", videoAtSec: 12 },
      { id: "d", body: "📌 بلا وقت", videoAtSec: null },
      { id: "e", body: "📌 انحذفت", videoAtSec: 5, deleted: true },
    ];
    expect(keyMoments(list).map((m) => m.id)).toEqual(["c", "a"]);
  });
});
