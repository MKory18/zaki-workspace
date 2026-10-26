import { describe, expect, it } from "vitest";
import { DESCRIPTION_MAX, IDEA_TITLE_MAX, commentDraft, momentLink, sessionDraft, startFromQuery } from "@/lib/watch/convert";

const session = { id: "s1", title: "Big Buck Bunny" };
const words = { momentOf: "لحظة من", summary: "اللحظات المهمة:" };

describe("«حوّل»: the link back to the moment", () => {
  it("points at the session page at the comment's second", () => {
    expect(momentLink("s1", 754.9)).toBe("/watch/s1?t=754");
    expect(momentLink("s1", -3)).toBe("/watch/s1?t=0");
  });

  it("reads `?t=` back, and nothing that is not a second", () => {
    expect(startFromQuery("754")).toBe(754);
    expect(startFromQuery(["90", "1"])).toBe(90);
    for (const t of [undefined, "", "-5", "abc", "12:30", "9999999", "86401"]) expect(startFromQuery(t), String(t)).toBeNull();
  });
});

describe("«حوّل»: a comment becomes an idea, a task or a project", () => {
  it("its words are the title; the description says who, where, when and links back", () => {
    const d = commentDraft({ body: "نعمل فيديو متله لمنتجنا", authorName: "سارة", videoAtSec: 754 }, session, words);
    expect(d.title).toBe("نعمل فيديو متله لمنتجنا");
    expect(d.description).toContain("نعمل فيديو متله لمنتجنا");
    expect(d.description).toContain("«Big Buck Bunny» · 12:34 · سارة");
    expect(d.description).toContain("/watch/s1?t=754");
  });

  it("a «لحظة مهمة» loses its pin in the title", () => {
    expect(commentDraft({ body: "📌 الأرنب ظهر", authorName: "خالد", videoAtSec: 51 }, session, words).title).toBe("الأرنب ظهر");
  });

  it("a comment too short for a title (a bare pin, an emoji) is named by its session", () => {
    expect(commentDraft({ body: "📌", authorName: "خالد", videoAtSec: 3 }, session, words).title).toBe("لحظة من «Big Buck Bunny»");
    expect(commentDraft({ body: "👏", authorName: "خالد", videoAtSec: 3 }, session, words).title).toBe("لحظة من «Big Buck Bunny»");
  });

  it("a long comment is cut at a word, and the description never passes the limit", () => {
    const long = "كلمة ".repeat(200);
    const d = commentDraft({ body: long, authorName: "سارة", videoAtSec: 1 }, session, words);
    expect(d.title.length).toBeLessThanOrEqual(IDEA_TITLE_MAX);
    expect(d.title.endsWith("…")).toBe(true);
    expect(commentDraft({ body: "x".repeat(5000), authorName: "سارة", videoAtSec: 1 }, session, words).description.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
  });
});

describe("«حوّل الجلسة»: the session's summary becomes an idea or a project", () => {
  it("the session's name is the title; its key moments, in order, with their seconds and who marked them", () => {
    const d = sessionDraft(
      session,
      [
        { body: "📌 البداية", authorName: "سارة", videoAtSec: 12 },
        { body: "📌 الأرنب ظهر", authorName: "خالد", videoAtSec: 51 },
      ],
      words,
    );
    expect(d.title).toBe("Big Buck Bunny");
    expect(d.description).toBe("اللحظات المهمة:\n- 0:12 البداية (سارة)\n- 0:51 الأرنب ظهر (خالد)\n\n🎬 /watch/s1");
  });

  it("with no key moment, just the link to the session", () => {
    expect(sessionDraft(session, [], words).description).toBe("🎬 /watch/s1");
  });
});
