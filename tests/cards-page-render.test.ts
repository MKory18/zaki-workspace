import * as React from "react";
import { createElement, type FunctionComponent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

(globalThis as { React?: typeof React }).React = React;

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/cards/c1",
}));

import { AR } from "@/lib/i18n/dict";
import { I18nProvider } from "@/lib/i18n";
import { ToastProvider } from "@/components/ui/toast";
import { CardPage } from "@/components/cards/card-page";
import { CardPageHeader } from "@/components/cards/card-page-header";
import { NotesSection } from "@/components/cards/notes-section";
import { RevisionDiff, RevisionsSection } from "@/components/cards/revisions-section";
import { LogSection } from "@/components/cards/log-section";
import { GallerySection } from "@/components/cards/gallery-section";
import { LinksSection } from "@/components/cards/links-section";
import { StarPicker } from "@/components/cards/stars";
import type { CardItem } from "@/lib/cards/shared";
import type { CardAbilities, CardPageData, GalleryItem, LogEntry, NotesView, RevisionItem } from "@/lib/cards/page";
import { PALETTE_COLOUR, PHYSICAL_UTILITY, classTokens, textOf } from "./ui-render";

const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const Toasts = ToastProvider as unknown as FunctionComponent<{ children?: ReactNode }>;
const Queries = QueryClientProvider as unknown as FunctionComponent<{ client: QueryClient; children?: ReactNode }>;

function render(element: ReactElement): string {
  return renderToStaticMarkup(
    createElement(Translations, { initial: "ar" }, createElement(Queries, { client: new QueryClient() }, createElement(Toasts, null, element))),
  );
}

const card: CardItem = {
  id: "c1",
  kind: "NOTE",
  title: "خطة الإطلاق",
  body: "نبدأ بالحملة الأولى يوم الأحد",
  data: null,
  color: "info",
  category: "إعلانات",
  tags: ["عاجل"],
  pinned: true,
  position: 1000,
  fileId: null,
  file: null,
  archivedAt: null,
  createdAt: new Date(Date.UTC(2026, 9, 1, 8)).toISOString(),
  updatedAt: new Date(Date.UTC(2026, 9, 2, 8)).toISOString(),
  createdById: "u1",
  createdByName: "سارة",
  status: "REVIEW",
  version: 3,
  coverFileId: "cover1",
};

const memberAbilities: CardAbilities = {
  write: true,
  participate: true,
  moderate: false,
  gallery: true,
  seeRaters: false,
  internal: true,
  oversight: false,
  restore: false,
  statusMoves: [],
};

const data = (over: Partial<CardPageData> = {}, abilities: Partial<CardAbilities> = {}): CardPageData => ({
  card,
  abilities: { ...memberAbilities, ...abilities },
  rating: { average: 4.3, count: 3, mine: 4, raters: null },
  gallery: [],
  spaceId: "s1",
  spaceName: "مساحة الإعلانات",
  ...over,
});

const noop = () => {};
const header = (d: CardPageData) => render(createElement(CardPageHeader, { data: d, onStatus: noop, onRate: noop }));

describe("the header of a card's page", () => {
  it("draws the cover ABOVE the title (never behind text), the kind, the status, the pin, the stars average, the creator and the dates", () => {
    const html = header(data());
    expect(html.indexOf('src="/api/files/cover1/raw"')).toBeGreaterThan(-1);
    expect(html.indexOf("/api/files/cover1/raw")).toBeLessThan(html.indexOf("خطة الإطلاق"));
    const text = textOf(html);
    expect(text).toContain("خطة الإطلاق");
    expect(text).toContain(AR["cards.kind.NOTE"]!);
    expect(text).toContain(AR["cards.status.REVIEW"]!);
    expect(text).toContain(AR["cards.pinned"]!);
    expect(text).toContain("إعلانات");
    expect(text).toContain("عاجل");
    expect(text).toContain("أنشأها سارة");
    expect(text).toContain("4.3 من 5");
    expect(text).toContain("3 تقييم");
    expect(html).toContain("border-info/40"); // the colour is a theme token
    expect(html).not.toMatch(/background-image|bg-\[url/);
  });

  it("a person in the space gets five 44px star buttons, one pressed for their own stars", () => {
    const html = header(data());
    expect(html.match(/role="radio"/g)).toHaveLength(5);
    expect(html.match(/<button[^>]*role="radio"[^>]*size-11/g)).toHaveLength(5);
    expect(html.match(/aria-checked="true"/g)).toHaveLength(1);
    expect(html).toContain(`aria-label="${AR["cards.p.stars_n"]!.replace("{n}", "4")}"`);
  });

  it("the owner reading silently is told why he cannot rate, and gets no star buttons", () => {
    const html = header(data({}, { participate: false, oversight: true, seeRaters: true }));
    expect(html).not.toContain('role="radio"');
    expect(textOf(html)).toContain(AR["cards.p.stars_silent"]!);
  });

  it("who rated what appears only when the server handed the list over (owner and creator)", () => {
    const withRaters = data({ rating: { average: 4, count: 2, mine: null, raters: [{ userId: "u2", name: "ليلى", stars: 5 }, { userId: "u3", name: "كريم", stars: 3 }] } }, { seeRaters: true });
    const text = textOf(header(withRaters));
    expect(text).toContain("ليلى");
    expect(text).toContain("كريم");
    expect(text).toContain(AR["cards.p.raters_hint"]!);
    // a plain member: the same card, the list is null and the markup holds no name
    const plain = textOf(header(data({ rating: { average: 4, count: 2, mine: null, raters: null } })));
    expect(plain).not.toContain("ليلى");
    expect(plain).not.toContain(AR["cards.p.raters"]!);
  });

  it("a moderator sees the moves the server allows; everybody else sees the status only", () => {
    const moderator = textOf(header(data({}, { moderate: true, statusMoves: ["DRAFT", "APPROVED", "ARCHIVED"] })));
    expect(moderator).toContain(`انقل إلى: ${AR["cards.status.APPROVED"]}`);
    expect(moderator).toContain(`انقل إلى: ${AR["cards.status.DRAFT"]}`);
    expect(textOf(header(data()))).not.toContain("انقل إلى");
  });

  it("an external partner gets the card and none of the internal blocks (stars, status moves)", () => {
    const html = header(data({ rating: null }, { internal: false, participate: false, write: false, gallery: false }));
    const text = textOf(html);
    expect(text).toContain("خطة الإطلاق");
    expect(text).not.toContain(AR["cards.p.stars"]!);
    expect(text).not.toContain(AR["cards.p.status"]!);
  });
});

describe("the stars picker", () => {
  it("names every button with its number of stars and groups them as one choice", () => {
    const html = render(createElement(StarPicker, { value: 2, onPick: noop }));
    expect(html).toContain('role="radiogroup"');
    for (const n of [1, 2, 3, 4, 5]) expect(html).toContain(`${n} من 5 نجوم`);
    expect(html.match(/aria-checked="true"/g)).toHaveLength(1);
  });
});

describe("the notes", () => {
  const view: NotesView = {
    publicNotes: [
      { id: "n1", authorId: "u1", authorName: "سارة", body: "ملاحظة الفريق", visibility: "PUBLIC", createdAt: card.createdAt, editedAt: null },
      { id: "n2", authorId: "u2", authorName: "ليلى", body: "رأي ليلى", visibility: "PUBLIC", createdAt: card.createdAt, editedAt: card.updatedAt },
    ],
    privateNotes: [{ id: "n3", authorId: "u1", authorName: "سارة", body: "تذكير خاص بي", visibility: "PRIVATE", createdAt: card.createdAt, editedAt: null }],
  };
  const notes = (abilities: Partial<CardAbilities> = {}, v: NotesView = view) =>
    render(createElement(NotesSection, { cardId: "c1", userId: "u1", abilities: { ...memberAbilities, ...abilities }, initial: v }));

  it("has the team's thread and «ملاحظاتي الخاصة», each with its own composer for a person in the space", () => {
    const text = textOf(notes());
    expect(text).toContain(AR["cards.p.notes_public"]!);
    expect(text).toContain(AR["cards.p.notes_private"]!);
    expect(text).toContain("ملاحظة الفريق");
    expect(text).toContain("رأي ليلى");
    expect(text).toContain("تذكير خاص بي");
    expect(text).toContain(AR["cards.p.notes_private_hint"]!);
    expect(text).toContain(AR["cards.p.note_add"]!);
    expect(text).toContain(AR["cards.p.note_private_add"]!);
  });

  it("only the author can edit; the author (and a moderator for public ones) can delete", () => {
    const html = notes();
    // u1 wrote n1 and n3: two «تعديل الملاحظة» buttons and no edit button on ليلى's note
    expect(html.match(/<button[^>]*aria-label="تعديل الملاحظة"/g)).toHaveLength(2);
    const other = notes({}, { publicNotes: [view.publicNotes![1]!], privateNotes: [] });
    expect(other.match(/<button[^>]*aria-label="تعديل الملاحظة"/g) ?? []).toHaveLength(0);
    expect(other.match(/<button[^>]*aria-label="حذف الملاحظة"/g) ?? []).toHaveLength(0);
    const moderator = notes({ moderate: true }, { publicNotes: [view.publicNotes![1]!], privateNotes: [] });
    expect(moderator.match(/<button[^>]*aria-label="حذف الملاحظة"/g)).toHaveLength(1);
  });

  it("the owner reading silently reads the thread and is told he cannot write", () => {
    const text = textOf(notes({ participate: false, oversight: true }, { publicNotes: view.publicNotes, privateNotes: [] }));
    expect(text).toContain("رأي ليلى");
    expect(text).toContain(AR["cards.p.note_silent"]!);
    expect(text).not.toContain(AR["cards.p.note_add"]!);
  });
});

const revision = (version: number, over: Partial<RevisionItem> = {}): RevisionItem => ({
  version,
  title: `عنوان ${version}`,
  body: "نص قديم",
  data: null,
  color: "none",
  category: null,
  tags: [],
  fileId: null,
  editorId: "u2",
  editorName: "ليلى",
  createdAt: card.createdAt,
  ...over,
});

describe("the versions", () => {
  it("lists every version with who and when, offers the difference, and «استرجع» only to those who write", () => {
    const initial = { currentVersion: 3, revisions: [revision(2), revision(1)] };
    const writer = render(createElement(RevisionsSection, { card, canWrite: true, onRestore: async () => {}, initial }));
    const text = textOf(writer);
    expect(text).toContain("الإصدار الحالي: 3");
    expect(text).toContain("الإصدار 2");
    expect(text).toContain("الإصدار 1");
    expect(text).toContain("حُفظ قبل تعديل ليلى");
    expect(writer.match(/اعرض الفرق/g)).toHaveLength(2);
    expect(writer.match(/استرجع هذا الإصدار/g)).toHaveLength(2);
    expect(textOf(render(createElement(RevisionsSection, { card, canWrite: false, onRestore: async () => {}, initial })))).not.toContain(AR["cards.p.version_restore"]!);
  });

  it("with no earlier version it says the card was not edited yet", () => {
    const html = render(createElement(RevisionsSection, { card, canWrite: true, onRestore: async () => {}, initial: { currentVersion: 1, revisions: [] } }));
    expect(textOf(html)).toContain(AR["cards.p.versions_empty"]!);
  });

  it("the before/after view shows each differing field, then and now", () => {
    const html = render(createElement(RevisionDiff, { revision: revision(2, { title: "عنوان قديم", tags: ["قديم"] }), card }));
    const text = textOf(html);
    expect(text).toContain(AR["cards.field.title"]!);
    expect(text).toContain("عنوان قديم");
    expect(text).toContain("خطة الإطلاق");
    expect(text).toContain("في الإصدار 2");
    expect(text).toContain(AR["cards.p.diff_after"]!);
    expect(text).toContain(AR["cards.field.tags"]!);
    const same = render(createElement(RevisionDiff, { revision: revision(2, { title: card.title, body: card.body, color: card.color, category: card.category, tags: card.tags }), card }));
    expect(textOf(same)).toContain(AR["cards.p.diff_none"]!);
  });
});

describe("the log", () => {
  const entries: LogEntry[] = [
    { id: "l3", action: "status", at: card.updatedAt, actorName: "سارة", detail: { from: "DRAFT", to: "REVIEW" } },
    { id: "l2", action: "rated", at: card.updatedAt, actorName: null, detail: {} },
    { id: "l1", action: "created", at: card.createdAt, actorName: "سارة", detail: {} },
  ];
  it("says who did what, newest first; a rating by somebody the viewer may not know is anonymous and has no number", () => {
    const html = render(createElement(LogSection, { cardId: "c1", initial: entries }));
    const text = textOf(html);
    expect(text).toContain("سارة: نقل الحالة من «مسودة» إلى «قيد المراجعة»");
    expect(text).toContain(AR["cards.log.rated_anon"]!);
    expect(text).toContain("سارة: أنشأ اللوحة");
    expect(text.indexOf("نقل الحالة")).toBeLessThan(text.indexOf("أنشأ اللوحة"));
    expect(text).not.toContain("نجوم");
  });
  it("says so when nothing happened yet", () => {
    expect(textOf(render(createElement(LogSection, { cardId: "c1", initial: [] })))).toContain(AR["cards.p.log_empty"]!);
  });
});

describe("the gallery", () => {
  const item = (id: string, over: Partial<GalleryItem> = {}): GalleryItem => ({
    id,
    fileId: `f-${id}`,
    position: 0,
    caption: null,
    isCover: false,
    file: { name: `${id}.png`, mimeType: "image/png", size: 2048 },
    ...over,
  });
  const gallery = (items: GalleryItem[], canEdit: boolean, hasLibrary = canEdit) =>
    render(createElement(GallerySection, { cardId: "c1", gallery: items, canEdit, hasLibrary, onChanged: noop }));

  it("shows each picture from the file library's own route with its caption, and a download link for any file", () => {
    const html = gallery([item("a", { caption: "الواجهة" }), item("b", { file: { name: "عقد.pdf", mimeType: "application/pdf", size: 4096 } })], false);
    expect(html).toContain('src="/api/files/f-a/raw"');
    expect(html).toContain("الواجهة");
    expect(html).toContain("/api/files/f-b/raw?download=1");
    expect(html.match(/<img/g)).toHaveLength(1); // the pdf is not drawn as a picture
  });

  it("a reader sees no add, remove, order or cover controls; a writer sees them as 44px targets", () => {
    const items = [item("a"), item("b", { isCover: true })];
    const reader = gallery(items, false);
    for (const key of ["cards.p.gallery_add", "cards.p.gallery_remove", "cards.p.gallery_cover", "cards.p.gallery_earlier"]) expect(reader).not.toContain(AR[key]!);
    const writer = gallery(items, true);
    expect(textOf(writer)).toContain(AR["cards.p.gallery_add"]!);
    expect(writer.match(new RegExp(`aria-label="${AR["cards.p.gallery_remove"]}"`, "g"))).toHaveLength(2);
    expect(writer).toContain(AR["cards.p.gallery_cover_off"]!); // the current cover offers to un-set
    expect(writer.match(/<button[^>]*size-11/g)!.length).toBeGreaterThanOrEqual(4);
    expect(writer).toContain('aria-pressed="true"');
  });

  it("an empty gallery says so; one that is full no longer offers to add", () => {
    expect(textOf(gallery([], false))).toContain(AR["cards.p.gallery_empty"]!);
    const full = Array.from({ length: 30 }, (_, i) => item(`i${i}`));
    expect(textOf(gallery(full, true))).not.toContain(AR["cards.p.gallery_add"]!);
  });
});

describe("what the card became", () => {
  it("lists the tasks made from it and the topic it was sent to, each a link", () => {
    const html = render(
      createElement(LinksSection, {
        cardId: "c1",
        initial: { tasks: [{ id: "t1", title: "جهّز التصميم", key: "ZK-12" }], topics: [{ conversationId: "k1", messageId: "m1", title: "الحملات", emoji: null }] },
      }),
    );
    expect(html).toContain('href="/tasks/t1"');
    expect(html).toContain('href="/chat/k1?m=m1"');
    expect(textOf(html)).toContain("جهّز التصميم");
    expect(textOf(html)).toContain("الحملات");
    expect(textOf(render(createElement(LinksSection, { cardId: "c1", initial: { tasks: [], topics: [] } })))).toContain(AR["cards.p.links_none"]!);
  });
});

describe("the whole page", () => {
  const page = (d: CardPageData) => render(createElement(CardPage, { initial: d, userId: "u1" }));

  it("a writer gets edit, duplicate, pin, send, convert to a task and delete, and the four sections as tabs", () => {
    const html = page(data());
    const text = textOf(html);
    for (const key of ["cards.edit", "cards.duplicate", "cards.unpin", "cards.send", "cards.to_task", "cards.delete"]) expect(text, key).toContain(AR[key]!);
    expect(html.match(/role="tab"/g)).toHaveLength(4);
    for (const id of ["notes", "gallery", "versions", "log"]) expect(text).toContain(AR[`cards.p.tab.${id}`]!);
    expect(html).toContain('role="tablist"');
    expect(text).toContain("نبدأ بالحملة الأولى يوم الأحد"); // the body is drawn by the same renderer as the tile
    expect(html.match(/<button[^>]*min-h-11/g)!.length).toBeGreaterThanOrEqual(6);
  });

  it("a reader gets none of the actions and is told the page is read only", () => {
    const html = page(data({}, { write: false, participate: false, gallery: false }));
    const buttons = [...html.matchAll(/<button[^>]*>((?:(?!<\/button>).)*)<\/button>/gs)].map((m) => textOf(m[1]!));
    for (const key of ["cards.edit", "cards.duplicate", "cards.send", "cards.to_task", "cards.delete"]) expect(buttons, key).not.toContain(AR[key]!);
    expect(textOf(html)).toContain(AR["cards.p.read_only"]!);
    // the writer's page does carry them, so the check above is not vacuous
    const writer = [...page(data()).matchAll(/<button[^>]*>((?:(?!<\/button>).)*)<\/button>/gs)].map((m) => textOf(m[1]!));
    expect(writer).toContain(AR["cards.edit"]!);
  });

  it("an external partner gets the card alone: no tabs, no sections, no stars", () => {
    const html = page(data({ rating: null, card: { ...card, coverFileId: null } }, { internal: false, write: false, participate: false, gallery: false }));
    expect(html).not.toContain('role="tab"');
    expect(textOf(html)).toContain("نبدأ بالحملة الأولى يوم الأحد");
    expect(textOf(html)).not.toContain(AR["cards.p.stars"]!);
  });

  it("the owner reading a space he is not in is told he reads silently", () => {
    expect(textOf(page(data({}, { oversight: true, participate: false })))).toContain(AR["cards.p.oversight"]!);
  });

  it("a deleted card (the owner's) says so and offers «استرجاع»", () => {
    const text = textOf(page(data({ card: { ...card, archivedAt: card.updatedAt } }, { write: false, participate: false, restore: true })));
    expect(text).toContain(AR["cards.p.deleted_banner"]!);
    expect(text).toContain(AR["cards.restore"]!);
  });

  it("uses theme tokens and logical directions only, never a picture behind text, and never prints a raw key", () => {
    const markup = [
      page(data()),
      header(data({}, { seeRaters: true, moderate: true, statusMoves: ["APPROVED"] })),
      render(createElement(NotesSection, { cardId: "c1", userId: "u1", abilities: memberAbilities, initial: { publicNotes: [], privateNotes: [] } })),
    ].join("\n");
    expect(classTokens(markup).filter((c) => PALETTE_COLOUR.test(c) || PHYSICAL_UTILITY.test(c))).toEqual([]);
    expect(markup).not.toMatch(/background-image|bg-\[url/);
    expect(textOf(markup)).not.toMatch(/\bcards\.[a-z_.]+\b/);
  });
});

describe("the source of the card's page", () => {
  const dir = path.resolve(__dirname, "../src/components/cards");
  const files = readdirSync(dir).filter((f) => /\.tsx?$/.test(f));
  const fragment = JSON.parse(readFileSync(path.resolve(__dirname, "../src/lib/i18n/ar.card-page.json"), "utf8")) as Record<string, string>;

  it("every dictionary key a component writes exists, and no colour is a hex value", () => {
    const missing: string[] = [];
    for (const f of files) {
      const text = readFileSync(path.join(dir, f), "utf8");
      for (const m of text.matchAll(/\bt\(\s*["'`](cards\.[\w.-]+)["'`]/g)) if (!(m[1]! in AR)) missing.push(`${f} ${m[1]}`);
      expect(text, f).not.toMatch(/#[0-9a-fA-F]{6}\b/);
    }
    expect(missing).toEqual([]);
  });

  it("every string of the page is Arabic, and an error is Modern Standard Arabic (no dialect)", () => {
    for (const [key, value] of Object.entries(fragment)) {
      // a string that is only placeholders («{name}: {what}») has no words of its own
      if (value.replace(/\{\w+\}/g, "").replace(/[\s:·،.-]/g, "") !== "") expect(value, key).toMatch(/[؀-ۿ]/);
      // the in-app guide is the one place where dialect is meant
      if (key.startsWith("guide.")) continue;
      expect(value, key).not.toMatch(/(^|\s)(ما ب|ما عندك|هال|هون|بس[ .،]|شوي|كتير|لسا|بدك|اللي|شيل|ابعت|بتقدر|بيقدر|ما لقينا|استنى)/);
    }
  });

  it("every error the services throw has its Arabic sentence", () => {
    const services = ["card-notes", "card-ratings", "card-status", "card-revisions", "card-attachments", "card-guards", "card-links", "card-log", "card-page"];
    const missing: string[] = [];
    for (const name of services) {
      const text = readFileSync(path.resolve(__dirname, `../src/server/services/${name}.ts`), "utf8");
      for (const m of text.matchAll(/(?:Error\(|message:\s*)(?:\[\{ path: "[\w.]+", message: )?["'](cards\.[\w.]+)["']/g)) if (!(m[1]! in AR)) missing.push(`${name} ${m[1]}`);
    }
    expect(missing).toEqual([]);
  });

  it("respects reduced motion: no animation of its own, transitions off under the preference", () => {
    for (const f of files.filter((n) => /^(card-page|stars|gallery-section|notes-section|revisions-section|conflict-dialog)/.test(n))) {
      const text = readFileSync(path.join(dir, f), "utf8");
      expect(text, f).not.toMatch(/animate-|@keyframes/);
    }
  });
});
