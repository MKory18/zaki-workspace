import { describe, expect, it } from "vitest";
import { normalizeArabic, queryTokens, rankEntries } from "@/lib/guide/match";
import { ARTICLES, articlesFor, search, searchEntries } from "@/lib/guide/articles";

describe("normalizeArabic: one spelling for the words people type", () => {
  it("strips the tashkeel (the little vowel marks)", () => {
    expect(normalizeArabic("الْمَهَامُّ")).toBe("المهام");
    expect(normalizeArabic("مَهَمَّة")).toBe("مهمه");
  });

  it("unifies the alef forms أ إ آ ٱ to ا", () => {
    expect(normalizeArabic("أضف")).toBe("اضف");
    expect(normalizeArabic("إضافة")).toBe("اضافه");
    expect(normalizeArabic("آيفون")).toBe("ايفون");
    expect(normalizeArabic("ٱلكتاب")).toBe("الكتاب");
  });

  it("unifies ى with ي and ة with ه", () => {
    expect(normalizeArabic("على")).toBe("علي");
    expect(normalizeArabic("مهمة")).toBe(normalizeArabic("مهمه"));
    expect(normalizeArabic("الرئيسية")).toBe("الرييسيه");
  });

  it("unifies the hamza carriers ؤ and ئ", () => {
    expect(normalizeArabic("مؤقتة")).toBe("موقته");
    expect(normalizeArabic("رئيس")).toBe("رييس");
  });

  it("drops the tatweel (the stretching dash)", () => {
    expect(normalizeArabic("المهـــام")).toBe("المهام");
  });

  it("reads Arabic-Indic and Persian digits as ordinary digits", () => {
    expect(normalizeArabic("٢٠٢٦")).toBe("2026");
    expect(normalizeArabic("۱۲۳")).toBe("123");
  });

  it("lowercases Latin letters and turns punctuation (Arabic and ASCII) into single spaces", () => {
    expect(normalizeArabic("CTRL+K")).toBe("ctrl k");
    expect(normalizeArabic("  ما هي؟  الأماكن!  ")).toBe("ما هي الاماكن");
    expect(normalizeArabic("اسم، ومسمّى؛ وبريد")).toBe("اسم ومسمي وبريد");
  });

  it("leaves an empty or blank input empty", () => {
    expect(normalizeArabic("")).toBe("");
    expect(normalizeArabic("   ")).toBe("");
  });
});

describe("queryTokens: what the person typed, ready to look for", () => {
  it("drops the definite article, with or without a one-letter prefix", () => {
    expect(queryTokens("المهام")).toEqual(["مهام"]);
    expect(queryTokens("بالشغل")).toEqual(["شغل"]);
    expect(queryTokens("والمشاريع")).toEqual(["مشاريع"]);
    expect(queryTokens("للمالك")).toEqual(["مالك"]);
  });

  it("keeps a short word whole (never strips it down to one letter)", () => {
    expect(queryTokens("ال")).toEqual(["ال"]);
    expect(queryTokens("الم")).toEqual(["الم"]);
  });

  it("splits on spaces, normalizes each word and removes duplicates", () => {
    expect(queryTokens("مشروع  لَوحة مشروع")).toEqual(["مشروع", "لوحه"]);
    expect(queryTokens("")).toEqual([]);
    expect(queryTokens("   ")).toEqual([]);
  });
});

describe("rankEntries: title first, then keywords, summary and the body", () => {
  const entries = [
    { id: "a", title: "طقس اليوم", summary: "حرارة", text: "كلام عن المهام في النص" },
    { id: "b", title: "المهام", summary: "شرح", text: "" },
    { id: "c", title: "غير ذلك", summary: "المهام هنا", keywords: ["مهمه"], text: "" },
  ];

  it("an empty query keeps everything in the original order", () => {
    expect(rankEntries(entries, "").map((e) => e.id)).toEqual(["a", "b", "c"]);
    expect(rankEntries(entries, "   ").map((e) => e.id)).toEqual(["a", "b", "c"]);
  });

  it("a title hit outranks a summary or a body hit", () => {
    expect(rankEntries(entries, "المهام").map((e) => e.id)).toEqual(["b", "c", "a"]);
  });

  it("every word must be found somewhere (and entries without it are left out)", () => {
    expect(rankEntries(entries, "المهام حرارة").map((e) => e.id)).toEqual(["a"]);
    expect(rankEntries(entries, "المهام غائب")).toEqual([]);
  });

  it("is stable: equal scores keep the original order", () => {
    const same = [
      { id: "x", title: "كلمة", summary: "" },
      { id: "y", title: "كلمة", summary: "" },
    ];
    expect(rankEntries(same, "كلمة").map((e) => e.id)).toEqual(["x", "y"]);
  });
});

describe("search: over the real articles, tolerant of how Arabic gets spelled", () => {
  const slugs = (query: string, audience: Parameters<typeof search>[1] = "managers") => search(query, audience).map((a) => a.slug);

  it("finds the task article by «مهمة», «مهمه», «المهام» and a vowelled spelling", () => {
    for (const q of ["مهمة", "مهمه", "المهام", "مَهَمَّة", "مهام"]) expect(slugs(q)[0], q).toBe("tasks");
  });

  it("finds the themes article by «ثيم»", () => {
    expect(slugs("ثيم")[0]).toBe("themes");
    expect(slugs("الثيمات")[0]).toBe("themes");
  });

  it("finds the install article by iPhone and Android spelled any way", () => {
    for (const q of ["آيفون", "ايفون", "أندرويد", "اندرويد", "تثبيت"]) expect(slugs(q), q).toContain("install");
  });

  it("finds the shortcuts article by the key name, in any case", () => {
    expect(slugs("ctrl")).toContain("shortcuts");
    expect(slugs("CTRL")).toContain("shortcuts");
  });

  it("two words must both be there: «مشروع لوحة» lands on the projects article", () => {
    expect(slugs("مشروع لوحة")[0]).toBe("projects");
    expect(slugs("مشروع زززززز")).toEqual([]);
  });

  it("answers nothing for gibberish, and everything (in the guide's order) for an empty search", () => {
    expect(slugs("ببببززززز")).toEqual([]);
    expect(search("", "managers").map((a) => a.slug)).toEqual(ARTICLES.map((a) => a.slug));
  });

  it("only searches what the viewer may read: a guest finds nothing about people, files or customers", () => {
    for (const q of ["تصفير", "الملفات", "العملاء", "المفاتيح", "الفرص", "الأقسام"]) expect(slugs(q, "everyone"), q).toEqual([]);
    // the same words find them for the people who may read them
    expect(slugs("تصفير", "managers")).toContain("team");
    expect(slugs("المفاتيح", "managers")).toContain("team");
    expect(slugs("الملفات", "staff")).toContain("company");
    expect(slugs("العملاء", "staff")).toContain("company");
    // ... and staff cannot reach the people article by its own words
    expect(slugs("تصفير", "staff")).not.toContain("team");
    expect(slugs("المفاتيح", "staff")).not.toContain("team");
  });

  it("never returns an article above the viewer's level, whatever the words", () => {
    for (const q of ["", "مهمة", "شخص", "حساب", "رتبة", "كلمة مرور"]) {
      const allowed = new Set(articlesFor("staff").map((a) => a.slug));
      for (const a of search(q, "staff")) expect(allowed.has(a.slug), `${q} → ${a.slug}`).toBe(true);
    }
  });
});

describe("searchEntries: what the index page hands to the search box", () => {
  it("lists the articles the viewer may read, in order, with text only from the parts they may read", () => {
    const guest = searchEntries("everyone");
    expect(guest.map((e) => e.slug)).toEqual(articlesFor("everyone").map((a) => a.slug));
    const joined = guest.map((e) => `${e.title} ${e.summary} ${e.text}`).join("\n");
    expect(joined).not.toContain("المكتبة");
    expect(joined).not.toContain("العملاء");
    const manager = searchEntries("managers");
    expect(manager.map((e) => e.slug)).toEqual(ARTICLES.map((a) => a.slug));
    expect(manager.find((e) => e.slug === "team")?.badge).toBe(true);
    expect(manager.find((e) => e.slug === "start")?.badge).toBe(false);
  });
});
