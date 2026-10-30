import { describe, expect, it } from "vitest";
import { MAX_QUERY_CHARS, arabicSearch, cleanQuery, findSpelled, foldForSearch, foldedIncludes } from "@/lib/search/arabic";
import { applyFilter, NO_FILTER } from "@/lib/cards/view";
import type { CardItem } from "@/lib/cards/shared";

/**
 * ARABIC-TOLERANT SEARCH — the pure half (the pattern the database matches with `~*`; the database half is
 * tests/db/arabic-search.test.ts). The pattern is written in the common subset of PostgreSQL's ARE and JavaScript,
 * so here the JavaScript engine stands in for the matching.
 */

const hit = (query: string, text: string): boolean => {
  const s = arabicSearch(query);
  return s ? new RegExp(s.source, "i").test(text) : false;
};

describe("the letters that are one letter", () => {
  it("every alef is the same alef, in both directions", () => {
    for (const typed of ["أحمد", "احمد", "إحمد", "آحمد", "ٱحمد"]) {
      for (const stored of ["أحمد", "احمد", "إحمد", "آحمد", "ٱحمد"]) expect(hit(typed, stored), `${typed} / ${stored}`).toBe(true);
    }
    expect(hit("امل", "تأمل؟ لا — أمل هنا")).toBe(true);
  });

  it("ة and ه are one letter, in both directions", () => {
    expect(hit("مدرسه", "مدرسة الحي")).toBe(true);
    expect(hit("مدرسة", "مدرسه الحي")).toBe(true);
    expect(hit("مدرسة", "مدرسة الحي")).toBe(true);
  });

  it("ى and ي are NOT one letter: «علي» and «على» are different words", () => {
    expect(hit("علي", "على الطاولة")).toBe(false);
    expect(hit("على", "اتصل بعلي")).toBe(false);
    expect(hit("علي", "اتصل بعلي")).toBe(true);
    expect(hit("على", "على الطاولة")).toBe(true);
    // ئ and ؤ stay as typed too
    expect(hit("سائل", "سايل")).toBe(false);
    expect(hit("مؤمن", "مومن")).toBe(false);
  });

  it("Persian ک and ی are the Arabic ك and ي", () => {
    expect(hit("كتاب", "کتاب")).toBe(true);
    expect(hit("ياسر", "یاسر")).toBe(true);
  });

  it("unrelated letters do not match, and a search is a substring of the text", () => {
    expect(hit("احمد", "محمد")).toBe(false);
    expect(hit("مدرس", "مدرسة")).toBe(true);
    expect(hit("رسة", "مدرسة")).toBe(true);
  });
});

describe("tashkeel and tatweel", () => {
  it("marks in the stored text are optional between the letters", () => {
    expect(hit("محمد", "مُحَمَّد")).toBe(true);
    expect(hit("محمد", "مـحـمـد")).toBe(true);
    expect(hit("الله", "اللّٰه")).toBe(true);
    expect(hit("اسم", "ٱسْمُ")).toBe(true);
    expect(hit("آمن", "آمن")).toBe(true);
  });

  it("marks and tatweel in the query are dropped, so the plain text is found", () => {
    expect(hit("مُحَمَّد", "محمد")).toBe(true);
    expect(hit("محـمد", "محمد")).toBe(true);
    expect(arabicSearch("ًـ")).toBeNull();
  });
});

describe("digits", () => {
  it("Arabic-Indic, Persian and Western digits are the same digit, any direction", () => {
    for (const typed of ["123", "١٢٣", "۱۲۳"]) {
      for (const stored of ["طلب 123", "طلب ١٢٣", "طلب ۱۲۳"]) expect(hit(typed, stored), `${typed} / ${stored}`).toBe(true);
    }
    expect(hit("٤٥٦", "فاتورة 456")).toBe(true);
    // Persian ۴۵۶ is not the Arabic-Indic ٤٥٦ code point, but it is the same number
    expect(hit("۴۵۶", "فاتورة ٤٥٦")).toBe(true);
    expect(hit("١٢٣", "طلب 124")).toBe(false);
  });
});

describe("Latin, spaces and plain searches are as before", () => {
  it("Latin is case-insensitive", () => {
    expect(hit("Report", "the REPORT is late")).toBe(true);
    expect(hit("report", "Reports")).toBe(true);
    expect(hit("zq1a2b3c", "plan zq1a2b3c")).toBe(true);
    expect(hit("report", "repor")).toBe(false);
  });

  it("a run of white space is one gap that matches any run of white space", () => {
    expect(cleanQuery("  a   b \t c  ")).toBe("a b c");
    expect(hit("اجتماع   الفريق", "اجتماع\n الفريق")).toBe(true);
    expect(hit("اجتماع الفريق", "اجتماعالفريق")).toBe(false);
  });

  it("the prefix pattern is anchored at the start", () => {
    const s = arabicSearch("احمد")!;
    expect(new RegExp(s.prefix, "i").test("أحمد علي")).toBe(true);
    expect(new RegExp(s.prefix, "i").test("اخو أحمد")).toBe(false);
    expect(new RegExp(s.source, "i").test("اخو أحمد")).toBe(true);
  });
});

describe("what is typed can never be an operator", () => {
  const nasty = [".*", "(", ")", "\\", "%", "_", "[", "]", "a|b", "^abc$", "a{1,2}", "a+", "a?", "(?i)x", "***=x", "a\\", "[a-z]", "(a", "x)", "\\1", "\\s", "\\d+", "a.b", "-", "/", "'; DROP TABLE \"Task\"; --"];

  it("each one is a literal: it matches itself and not what an operator would match", () => {
    for (const q of nasty) {
      const s = arabicSearch(q);
      expect(s, q).not.toBeNull();
      expect(() => new RegExp(s!.source, "i"), q).not.toThrow();
      expect(new RegExp(s!.source, "i").test(`xx ${q} yy`), `finds itself: ${q}`).toBe(true);
    }
    expect(hit(".*", "anything at all")).toBe(false);
    expect(hit("a.b", "axb")).toBe(false);
    expect(hit("a|b", "a")).toBe(false);
    expect(hit("a+", "aaa")).toBe(false);
    expect(hit("\\d+", "123")).toBe(false);
    expect(hit("[a-z]", "q")).toBe(false);
    expect(hit("(?i)x", "x")).toBe(false);
    expect(hit("^abc$", "abc")).toBe(false);
  });

  it("%, _ and ' are plain characters (no LIKE here) and need no escape", () => {
    expect(hit("50%", "خصم 50% اليوم")).toBe(true);
    expect(hit("50%", "خصم 500 اليوم")).toBe(false);
    expect(hit("a_b", "a_b")).toBe(true);
    expect(hit("a_b", "axb")).toBe(false);
  });

  it("every operator character of the pattern is preceded by a backslash", () => {
    const s = arabicSearch(".*(a)[b]{c}|d?e+f^g$h\\i-j/k")!;
    // strip the escapes that are right, what is left must carry no bare operator
    const bare = s.source.replace(/\\[\\^$.|?*+()[\]{}\-/]/g, "").replace(/\[[^\]]*\]\*/g, "").replace(/\\s\+/g, "");
    expect(bare).not.toMatch(/[\\^$.|?*+()[\]{}]/);
  });

  it("control characters, NUL, direction marks and lone surrogates are dropped", () => {
    expect(cleanQuery("a\u0000b\u0007c")).toBe("abc");
    expect(cleanQuery("‮abc‏")).toBe("abc");
    expect(cleanQuery("ab\uD800cd")).toBe("ab cd");
    expect(cleanQuery("ab\uDC00cd")).toBe("ab cd");
    expect(arabicSearch("\u0000")).toBeNull();
    const s = arabicSearch("x\u0000y")!;
    expect(s.source).not.toContain("\u0000");
  });

  it("a very long query is cut to 100 characters (by character, never in the middle of one)", () => {
    const long = "ا".repeat(500);
    expect(Array.from(cleanQuery(long)).length).toBe(MAX_QUERY_CHARS);
    expect(Array.from(arabicSearch(long)!.text).length).toBe(MAX_QUERY_CHARS);
    const emoji = "😀".repeat(300);
    expect(Array.from(cleanQuery(emoji)).length).toBe(MAX_QUERY_CHARS);
    expect(cleanQuery(emoji)).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    // the pattern of the longest query stays small and compiles
    expect(arabicSearch("أ".repeat(1000))!.source.length).toBeLessThan(5000);
  });

  it("empty, space-only and mark-only input is nothing to search", () => {
    expect(arabicSearch("")).toBeNull();
    expect(arabicSearch("   ")).toBeNull();
    expect(arabicSearch("\t\n")).toBeNull();
    expect(arabicSearch(undefined as unknown as string)).toBeNull();
    expect(arabicSearch(null as unknown as string)).toBeNull();
    expect(cleanQuery("")).toBe("");
  });
});

describe("the browser's side: pickers and snippets", () => {
  it("foldForSearch gives one spelling", () => {
    expect(foldForSearch("أَحْمَد")).toBe("احمد");
    expect(foldForSearch("مدرسة")).toBe("مدرسه");
    expect(foldForSearch("طلب ١٢٣")).toBe("طلب 123");
    expect(foldForSearch("  REPORT   Two ")).toBe("report two");
    // علي / على stay different
    expect(foldForSearch("علي")).not.toBe(foldForSearch("على"));
  });

  it("foldedIncludes filters a list the way the database does", () => {
    expect(foldedIncludes("أحمد الخطيب", "احمد")).toBe(true);
    expect(foldedIncludes("مدرسة", "مدرسه")).toBe(true);
    expect(foldedIncludes("على", "علي")).toBe(false);
    expect(foldedIncludes("Sara", "SAR")).toBe(true);
    expect(foldedIncludes("anything", "")).toBe(true);
    expect(foldedIncludes("anything", ".*")).toBe(false);
  });

  it("findSpelled centres a snippet on the match, however it was spelled", () => {
    expect(findSpelled("قال أحمد إن الأمر جاهز", "احمد")).toBe(4);
    expect(findSpelled("nothing here", "احمد")).toBe(-1);
    expect(findSpelled("x", "")).toBe(-1);
  });
});

describe("the cards screen filter reads digits too", () => {
  const card = (title: string): CardItem => ({ id: title, title, kind: "NOTE", body: null, data: null, category: null, tags: [], color: "NONE", pinned: false, position: 0, createdAt: "2026-01-01T00:00:00.000Z" }) as unknown as CardItem;
  it("«١٢٣» finds a card titled «123» and the other way round", () => {
    expect(applyFilter([card("طلب 123"), card("طلب 999")], { ...NO_FILTER, q: "١٢٣" }).map((c) => c.id)).toEqual(["طلب 123"]);
    expect(applyFilter([card("طلب ١٢٣")], { ...NO_FILTER, q: "123" })).toHaveLength(1);
  });
});
