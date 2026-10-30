import * as React from "react";
import { createElement, type FunctionComponent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

// The components are TSX; under vitest their JSX compiles to React.createElement, which needs a global React.
(globalThis as { React?: typeof React }).React = React;

const where = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({
  usePathname: () => where.pathname,
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
}));

import { AppShell } from "@/components/app-shell";
import { ToastProvider } from "@/components/ui/toast";
import { I18nProvider } from "@/lib/i18n";
import { AR } from "@/lib/i18n/dict";
import { audienceOf } from "@/lib/guide/audience";
import { buildNav, type NavRole, type NavSubject } from "@/lib/nav/places";
import type { NavOrder } from "@/lib/nav/order";
import type { SpaceLayout } from "@/lib/cards/shared";
import { effectiveCapabilities } from "@/server/policy/capabilities";
import type { CurrentUser } from "@/server/auth";

/**
 * «فقط لوحات», on screen: the side menu and the phone's bar draw the map of the space the person is in. A general space is
 * as it was; a space of «لوحات» or «تصنيع» offers «اللوحات» then «الإدارة», has no tab strip, and still carries the tour's
 * «places» hook. The top bar names the place.
 */

const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const Queries = QueryClientProvider as unknown as FunctionComponent<{ client: QueryClient; children?: ReactNode }>;
const Toasts = ToastProvider as unknown as FunctionComponent<{ children?: ReactNode }>;

const USER: CurrentUser = { id: "u1", email: "a@example.test", username: "a", name: "أحمد", locale: "ar", mustChangePassword: false, transparencyPending: false, tv: 0 };

function render(element: ReactElement): string {
  const client = new QueryClient();
  client.setQueryData(["orgs"], { organizations: [] });
  client.setQueryData(["notifications"], { items: [], unreadCount: 0 });
  return renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(Queries, { client }, createElement(Toasts, null, element))));
}

function shell(role: NavRole, layout: SpaceLayout | undefined, pathname: string, navOrder?: NavOrder | null, spaceManager = false): string {
  where.pathname = pathname;
  const subject: NavSubject = { role, caps: [...effectiveCapabilities({ role })], spaceManager, ...(layout ? { spaceLayout: layout } : {}) };
  return render(
    createElement(AppShell, {
      user: USER,
      nav: buildNav(subject),
      navOrder,
      rank: role,
      audience: audienceOf({ isExternal: role === "GUEST", caps: subject.caps }),
      isGuest: role === "GUEST",
      space: { id: "s1", name: "اللوحات", emoji: null },
      children: createElement("p", null, "x"),
    }),
  );
}

function outerOf(markup: string, open: RegExp, tag: string): string {
  const m = open.exec(markup);
  if (!m) throw new Error(`no ${open} in: ${markup.slice(0, 300)}`);
  const re = new RegExp(`<${tag}\\b|</${tag}>`, "g");
  re.lastIndex = m.index + 1;
  let depth = 1;
  for (let hit = re.exec(markup); hit; hit = re.exec(markup)) {
    depth += hit[0].startsWith("</") ? -1 : 1;
    if (depth === 0) return markup.slice(m.index, hit.index + hit[0].length);
  }
  throw new Error(`unclosed <${tag}>`);
}
const bottomBar = (html: string) => outerOf(html, /<nav[^>]*class="fixed bottom-0[^"]*"[^>]*>/, "nav");
const sidebarPlaces = (html: string) => outerOf(outerOf(html, /<aside\b[^>]*>/, "aside"), /<nav[^>]*data-tour="places"[^>]*>/, "nav");
const hrefs = (markup: string) => [...markup.matchAll(/<a\b[^>]*href="([^"]*)"/g)].map((m) => m[1] as string);
const labels = (markup: string) => [...markup.matchAll(/<span class="(?:max-w-full )?truncate">([^<]*)<\/span>/g)].map((m) => m[1]);
const tourHooks = (html: string) => [...html.matchAll(/data-tour="([^"]+)"/g)].map((m) => m[1] as string);

const STANDARD_HREFS = ["/", "/chat", "/my-work", "/files", "/watch", "/members"];
const CARDS_LAYOUTS: SpaceLayout[] = ["CARDS", "MANUFACTURING"];

describe("a general space (STANDARD, or no layout): the menu is as it was", () => {
  for (const layout of ["STANDARD", undefined] as const) {
    it(`${layout ?? "no layout"}: the bar and the menu hold the six places, in order, «اللوحات» nowhere`, () => {
      const html = shell("OWNER", layout, "/projects");
      expect(hrefs(bottomBar(html))).toEqual(STANDARD_HREFS);
      expect(hrefs(sidebarPlaces(html))).toEqual(STANDARD_HREFS);
      expect(sidebarPlaces(html)).not.toContain(AR["nav.place.cards"] as string);
      expect(bottomBar(html)).not.toContain("/cards");
    });
  }

  it("the two layouts that are not cards draw the very same markup as a space with no layout", () => {
    expect(shell("MEMBER", "STANDARD", "/my-work")).toBe(shell("MEMBER", undefined, "/my-work"));
  });
});

describe("a space of «لوحات» or «تصنيع»: «اللوحات» then «الإدارة»", () => {
  for (const layout of CARDS_LAYOUTS) {
    describe(layout, () => {
      it("the owner: the side menu and the phone's bar hold [/cards, /members], «اللوحات» first and named", () => {
        const html = shell("OWNER", layout, "/cards");
        expect(hrefs(sidebarPlaces(html))).toEqual(["/cards", "/members"]);
        expect(hrefs(bottomBar(html))).toEqual(["/cards", "/members"]);
        expect(labels(sidebarPlaces(html))[0]).toBe("اللوحات");
        expect(labels(bottomBar(html))).toEqual(["اللوحات", "الإدارة"]);
      });

      it("none of the hidden places is drawn in either: no «اليوم», «الدردشة», «الشغل», «المكتبة», «نتفرّج سوا»", () => {
        const html = shell("OWNER", layout, "/cards");
        for (const part of [sidebarPlaces(html), bottomBar(html)]) {
          for (const href of ["/chat", "/my-work", "/files", "/watch"]) expect(hrefs(part)).not.toContain(href);
          expect(hrefs(part)).not.toContain("/");
          for (const key of ["nav.place.today", "nav.place.chat", "nav.place.work", "nav.place.library", "nav.place.watch"]) expect(part).not.toContain(AR[key] as string);
        }
      });

      it("a plain member: «اللوحات» then «الإدارة» (the team and «لوحتي»); an external partner: «اللوحات» alone", () => {
        const member = shell("MEMBER", layout, "/cards");
        expect(hrefs(bottomBar(member))).toEqual(["/cards", "/members"]);
        expect(labels(bottomBar(member))).toEqual(["اللوحات", "الإدارة"]);
        const guest = shell("GUEST", layout, "/cards");
        expect(hrefs(bottomBar(guest))).toEqual(["/cards"]);
        expect(hrefs(sidebarPlaces(guest))).toEqual(["/cards"]);
      });

      it("«اللوحات» is the current place on /cards (the page itself) and on a card (inside it); nothing else is marked", () => {
        const on = shell("OWNER", layout, "/cards");
        expect(/<a\b[^>]*href="\/cards"[^>]*>/.exec(sidebarPlaces(on))?.[0]).toContain('aria-current="page"');
        expect(/<a\b[^>]*href="\/cards"[^>]*>/.exec(bottomBar(on))?.[0]).toContain('aria-current="page"');
        expect(sidebarPlaces(on).match(/aria-current/g)).toHaveLength(1);
        const inside = shell("OWNER", layout, "/cards/abc");
        expect(/<a\b[^>]*href="\/cards"[^>]*>/.exec(sidebarPlaces(inside))?.[0]).toContain('aria-current="true"');
        expect(bottomBar(inside).match(/aria-current/g)).toHaveLength(1);
      });

      it("there is no tab strip (the place has no tabs), and the top bar reads «اللوحات» on the page and on a card", () => {
        for (const path of ["/cards", "/cards/abc"]) {
          const html = shell("OWNER", layout, path);
          expect(tourHooks(html)).not.toContain("tabs");
          expect(html).toContain('<p class="hidden shrink-0 font-display text-2xl leading-tight text-fg md:block">اللوحات</p>');
          // the page's own heading is the only h1: the frame draws none
          expect(html).not.toContain("<h1");
        }
      });

      it("the phone's mark goes home to «اللوحات» (there is no «اليوم» to go to)", () => {
        const html = shell("OWNER", layout, "/cards");
        expect(html).toMatch(/<a aria-label="اللوحات" class="grid size-11[^"]*" href="\/cards">/);
      });

      it("the tour keeps its hooks: the places twice (bar and menu), search, inbox, avatar — and no tab strip to point at", () => {
        const hooks = tourHooks(shell("OWNER", layout, "/cards"));
        expect(hooks.filter((h) => h === "places")).toHaveLength(2);
        for (const hook of ["search", "inbox", "avatar"]) expect(hooks, hook).toContain(hook);
        expect(hooks).not.toContain("tabs");
      });

      it("a page of a hidden place still renders inside the frame (a link kept, a topic opened from «أرسل»), marking nothing", () => {
        const html = shell("OWNER", layout, "/chat/abc");
        expect(html).toContain("<p>x</p>");
        expect(sidebarPlaces(html)).not.toContain("aria-current");
        expect(hrefs(sidebarPlaces(html))).toEqual(["/cards", "/members"]);
      });

      it("a saved order composes: with none, «اللوحات» first; one saved in a general space keeps it first; one saved here is followed", () => {
        expect(hrefs(sidebarPlaces(shell("OWNER", layout, "/cards", null)))).toEqual(["/cards", "/members"]);
        const general: NavOrder = { places: ["library", "chat", "today", "work", "watch", "admin"], tabs: {} };
        expect(hrefs(sidebarPlaces(shell("OWNER", layout, "/cards", general)))).toEqual(["/cards", "/members"]);
        expect(hrefs(bottomBar(shell("OWNER", layout, "/cards", general)))).toEqual(["/cards", "/members"]);
        const here: NavOrder = { places: ["admin", "cards"], tabs: {} };
        expect(hrefs(sidebarPlaces(shell("OWNER", layout, "/cards", here)))).toEqual(["/members", "/cards"]);
        expect(hrefs(bottomBar(shell("OWNER", layout, "/cards", here)))).toEqual(["/members", "/cards"]);
      });

      it("the tabs of «الإدارة» still show above its pages inside a cards space (the owner's own tabs, unchanged)", () => {
        const html = shell("OWNER", layout, "/analytics");
        expect(tourHooks(html)).toContain("tabs");
      });

      it("a manager of the space sees «المساحة» among the admin tabs there", () => {
        const html = shell("MEMBER", layout, "/spaces/current", null, true);
        expect(html).toContain('href="/spaces/current"');
      });
    });
  }
});
