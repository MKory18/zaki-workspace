import * as React from "react";
import { createElement, type FunctionComponent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { artUrl } from "@/lib/themes/decor";

// The pages are TSX; under vitest their JSX compiles to React.createElement, which needs a global React.
(globalThis as { React?: typeof React }).React = React;

type Persona = "guest" | "staff" | "manager";
interface Who {
  user: { id: string; name: string };
  actor: { userId: string; orgId: string; role: string; caps: Set<string>; isOwner: boolean; isExternal: boolean };
}

const state = vi.hoisted(() => ({ current: null as Who | null }));

vi.mock("@/app/(app)/_access", () => ({
  pageActor: async () => {
    if (!state.current) throw new Error("NEXT_REDIRECT:/login");
    return state.current;
  },
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  usePathname: () => "/guide",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
}));

import GuidePage, { metadata as indexMetadata } from "@/app/(app)/guide/page";
import GuideArticlePage, { metadata as articleMetadata } from "@/app/(app)/guide/[slug]/page";
import { ArticleBody } from "@/components/guide/article-body";
import { ARTICLES, blocksFor, findArticle } from "@/lib/guide/articles";
import { I18nProvider } from "@/lib/i18n";
import { getServerT } from "@/lib/i18n/server";

const { t } = getServerT();
const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;

function as(persona: Persona): void {
  state.current = {
    user: { id: `u-${persona}`, name: persona },
    actor: {
      userId: `u-${persona}`,
      orgId: "org1",
      role: persona === "guest" ? "GUEST" : persona === "manager" ? "ADMIN" : "MEMBER",
      caps: new Set(persona === "manager" ? ["users.manage", "directory.view"] : persona === "staff" ? ["directory.view"] : []),
      isOwner: false,
      isExternal: persona === "guest",
    },
  };
}

async function render(page: Promise<ReactElement> | ReactElement): Promise<string> {
  const element = await page;
  return renderToStaticMarkup(createElement(Translations, { initial: "ar" }, element));
}

const hrefs = (html: string) => [...html.matchAll(/href="(\/guide[^"]*)"/g)].map((m) => m[1]);

describe("the browser tab", () => {
  it("says «الدليل» on the index and on every article, and never names an article (the title would reach somebody who may not open it)", () => {
    expect(indexMetadata.title).toBe(t("guide.title"));
    expect(articleMetadata.title).toBe(t("guide.title"));
  });
});

describe("/guide: the index", () => {
  it("a staff member gets the search box and a card for every article they may read, not the people article", async () => {
    as("staff");
    const html = await render(GuidePage());
    expect(html).toContain(t("guide.title"));
    expect(html).toContain(t("guide.subtitle"));
    expect(html).toContain('type="search"');
    expect(html).toContain(t("guide.search.label"));
    const links = hrefs(html);
    for (const a of ARTICLES.filter((x) => x.audience !== "managers")) {
      expect(links, a.slug).toContain(`/guide/${a.slug}`);
      expect(html, a.slug).toContain(a.title);
    }
    expect(links).not.toContain("/guide/team");
    expect(html).not.toContain(findArticle("team")!.title);
  });

  it("a manager also gets the people article, marked as being for those who manage accounts", async () => {
    as("manager");
    const html = await render(GuidePage());
    expect(hrefs(html)).toContain("/guide/team");
    expect(html).toContain(findArticle("team")!.title);
    expect(html).toContain(t("guide.badge.managers"));
  });

  it("a guest gets only the articles that apply to a guest, and nothing of the staff material", async () => {
    as("guest");
    const html = await render(GuidePage());
    const links = hrefs(html);
    for (const slug of ["start", "places", "spaces", "projects", "themes", "install", "privacy", "shortcuts"]) {
      expect(links, slug).toContain(`/guide/${slug}`);
    }
    for (const slug of ["tasks", "company", "team", "ideas-goals"].filter((s) => findArticle(s)?.audience !== "everyone")) {
      expect(links, slug).not.toContain(`/guide/${slug}`);
    }
    for (const word of ["المكتبة", "العملاء", "الملفات", "الصلاحيات", t("guide.badge.managers")]) {
      expect(html, word).not.toContain(word);
    }
  });

  it("is mobile-first: one column of cards, a 16px gutter and no fixed widths", async () => {
    as("staff");
    const html = await render(GuidePage());
    expect(html).toMatch(/class="[^"]*\bp-4\b/);
    expect(html).not.toMatch(/\bw-\[\d{3,}px\]/);
    expect(html).not.toMatch(/\b(left|right)-\d/);
  });

  it("remembers that the guide was opened (the first-steps card ticks «افتح الدليل» on this device)", async () => {
    as("staff");
    const element = await GuidePage();
    // the mark is a client component that renders nothing; it must be somewhere in the tree with the person's id
    expect(JSON.stringify(element)).toContain("u-staff");
  });

  it("sends the signed-out visitor to login (the page guard is pageActor)", async () => {
    state.current = null;
    await expect(GuidePage()).rejects.toThrow("NEXT_REDIRECT:/login");
  });
});

describe("/guide/[slug]: an article", () => {
  it("shows the title, the summary and the steps, with a way back to the guide", async () => {
    as("staff");
    const html = await render(GuideArticlePage({ params: { slug: "tasks" } }));
    const article = findArticle("tasks")!;
    expect(html).toContain(article.title);
    expect(html).toContain(article.summary);
    expect(html).toContain("<ol");
    expect(hrefs(html)).toContain("/guide");
    expect(html).toContain(t("guide.back"));
  });

  it("links the previous and the next article the viewer can read", async () => {
    as("staff");
    const html = await render(GuideArticlePage({ params: { slug: "projects" } }));
    const links = hrefs(html);
    expect(links).toContain("/guide/tasks");
    expect(links).toContain("/guide/ideas-goals");
    expect(html).toContain(t("guide.article.prev"));
    expect(html).toContain(t("guide.article.next"));
  });

  it("wires each article to its agreed drawing, and draws nothing while no artwork has shipped", async () => {
    // The slot names are the contract with the owner (decor.ts ART_SLOTS); the file is theirs to add later.
    expect(findArticle("start")!.art).toBe("guide-welcome");
    expect(findArticle("install")!.art).toBe("guide-install-app");
    expect(findArticle("tasks")!.art ?? null).toBeNull();
    // No artwork has shipped, so the slot draws nothing at all (tests/art-available.test.ts owns that
    // rule). The page still names its drawing and never hand-writes a path: the URL comes from artUrl().
    for (const persona of ["guest", "staff", "manager"] as Persona[]) {
      as(persona);
      const start = await render(GuideArticlePage({ params: { slug: "start" } }));
      expect(start, persona).not.toContain("data-art-slot");
      expect(start, persona).not.toContain("/brand/art/");
    }
  });

  it("keeps the drawing between the title and the steps, sized so that a missing picture leaves no hole", () => {
    // The slot is a component whose own rule is «render nothing until the file exists»; the placement is
    // therefore asserted on the page source: after the </header> that carries the title, before the body.
    const source = readFileSync("src/app/(app)/guide/[slug]/page.tsx", "utf8");
    const art = source.indexOf("<ArtSlot");
    expect(art).toBeGreaterThan(source.indexOf("</header>"));
    expect(art).toBeLessThan(source.indexOf("<ArticleBody"));
    // max-h-* (not a fixed height) is what makes it collapse
    expect(source).toMatch(/<ArtSlot[^>]*className="[^"]*\bmax-h-/);
  });

  it("the first article has no «previous», the last has no «next»", async () => {
    as("manager");
    const first = await render(GuideArticlePage({ params: { slug: ARTICLES[0]!.slug } }));
    expect(first).not.toContain(t("guide.article.prev"));
    expect(first).toContain(t("guide.article.next"));
    const last = await render(GuideArticlePage({ params: { slug: ARTICLES[ARTICLES.length - 1]!.slug } }));
    expect(last).toContain(t("guide.article.prev"));
    expect(last).not.toContain(t("guide.article.next"));
  });

  it("404s for an unknown slug", async () => {
    as("manager");
    await expect(GuideArticlePage({ params: { slug: "no-such-article" } })).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(GuideArticlePage({ params: { slug: "" } })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("404s for an article the viewer may not read — the people article for staff and guests, the task article for guests", async () => {
    as("staff");
    await expect(GuideArticlePage({ params: { slug: "team" } })).rejects.toThrow("NEXT_NOT_FOUND");
    as("guest");
    await expect(GuideArticlePage({ params: { slug: "team" } })).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(GuideArticlePage({ params: { slug: "tasks" } })).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(GuideArticlePage({ params: { slug: "company" } })).rejects.toThrow("NEXT_NOT_FOUND");
    as("manager");
    await expect(render(GuideArticlePage({ params: { slug: "team" } }))).resolves.toContain(findArticle("team")!.title);
  });

  it("the same article reads differently to a guest and to staff (the places article keeps the library and the chat for staff)", async () => {
    as("staff");
    const staff = await render(GuideArticlePage({ params: { slug: "places" } }));
    as("guest");
    const guest = await render(GuideArticlePage({ params: { slug: "places" } }));
    expect(staff).toContain("المكتبة");
    expect(staff).toContain("الدردشة");
    expect(guest).not.toContain("المكتبة");
    expect(guest).not.toContain("الدردشة");
    expect(guest).toContain("الشغل");
  });

  it("a guest reads no staff-only line of a shared article, and the next/previous links skip staff articles", async () => {
    as("guest");
    const html = await render(GuideArticlePage({ params: { slug: "projects" } }));
    expect(hrefs(html)).not.toContain("/guide/tasks");
    expect(html).not.toContain("مشروع جديد");
  });

  it("every article renders for the people who may read it, without an error", async () => {
    for (const persona of ["guest", "staff", "manager"] as Persona[]) {
      as(persona);
      for (const article of ARTICLES) {
        const readable = persona === "manager" || (persona === "staff" && article.audience !== "managers") || article.audience === "everyone";
        if (!readable) continue;
        const html = await render(GuideArticlePage({ params: { slug: article.slug } }));
        expect(html, `${persona}/${article.slug}`).toContain(article.title);
      }
    }
  });
});

describe("ArticleBody: how each kind of block is drawn", () => {
  const body = (blocks: ReturnType<typeof blocksFor>) => render(createElement(ArticleBody, { blocks }));

  it("a warning shows ⚠️ with its words and 🔧 with the fix, together", async () => {
    const html = await body([{ type: "warn", text: "الخطر هنا", fix: "الحل هنا" }]);
    expect(html).toContain("⚠️");
    expect(html).toContain("🔧");
    expect(html).toContain("الخطر هنا");
    expect(html).toContain("الحل هنا");
    expect(html.indexOf("الخطر هنا")).toBeLessThan(html.indexOf("الحل هنا"));
    // the symbols are decoration: the words «تنبيه» and «الحل» are what a screen reader gets
    expect(html).toContain(t("guide.article.warn"));
    expect(html).toContain(t("guide.article.fix"));
  });

  it("steps are a numbered list with the numbers drawn as 1 2 3", async () => {
    const html = await body([{ type: "steps", title: "خطوات", items: ["أولًا", "ثانيًا", "ثالثًا"] }]);
    expect(html).toContain("<ol");
    expect(html).toContain("خطوات");
    for (const n of ["1", "2", "3"]) expect(html).toContain(`>${n}<`);
    expect(html.indexOf("أولًا")).toBeLessThan(html.indexOf("ثانيًا"));
  });

  it("a list is bullets; a heading is a heading; a tip is a note", async () => {
    const html = await body([
      { type: "h", text: "عنوان فرعي" },
      { type: "list", items: ["نقطة"] },
      { type: "tip", text: "نصيحة لك" },
    ]);
    expect(html).toContain("<h2");
    expect(html).toContain("<ul");
    expect(html).toContain('role="note"');
    expect(html).toContain(t("guide.article.tip"));
  });

  it("keys are drawn as keyboard keys joined by a plus, with their words", async () => {
    const html = await body([{ type: "keys", keys: ["Ctrl", "K"], text: "افتح البحث" }]);
    expect((html.match(/<kbd/g) ?? []).length).toBe(2);
    expect(html).toContain("Ctrl");
    expect(html).toContain("+");
    expect(html).toContain("افتح البحث");
  });

  it("the keys stay left-to-right inside the right-to-left page (a shortcut reads Ctrl + K, not K + Ctrl)", async () => {
    const html = await body([{ type: "keys", keys: ["Ctrl", "K"], text: "افتح البحث" }]);
    expect(html).toMatch(/dir="ltr"/);
  });

  it("uses logical spacing and theme tokens only (no left/right, no hard-coded palette colour)", async () => {
    const all = ARTICLES.map((a) => blocksFor(a, "managers"));
    const html = (await Promise.all(all.map(body))).join("");
    expect(html).not.toMatch(/\b(ml|mr|pl|pr|left|right)-\d/);
    expect(html).not.toMatch(/\b(text|bg|border)-(red|green|blue|amber|emerald|sky|slate|gray|zinc|yellow|orange|violet|indigo|rose|teal|cyan|lime|purple|pink|fuchsia|black|white)\b/);
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
