import * as React from "react";
import { createElement, type FunctionComponent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// AppShell needs a pathname (and, through its parts, a router): stand-ins like the other render tests use.
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

/**
 * The first HTML already has the remembered state in it — the state the card and the side menu
 * keep in the `zk-fs` / `zk-sidebar` cookies, which the SERVER reads (src/app/(app)/page.tsx and
 * src/app/(app)/layout.tsx). Before the cookies, the card rendered nothing until an effect had
 * asked the device and the menu was 256px that shrank after the first paint: the task list jumped.
 */
(globalThis as { React?: typeof React }).React = React;

import { FirstStepsCardClient, cookieStateOfLocal } from "@/components/guide/first-steps-client";
import { FIRST_STEPS_COOKIE, FIRST_STEPS_STATES, parseFirstStepsCookie, firstStepsCookieString } from "@/components/guide/first-steps-cookie";
import { SIDEBAR_COOKIE, parseSidebarCookie } from "@/components/shell/sidebar-cookie";
import { AppShell } from "@/components/app-shell";
import { I18nProvider } from "@/lib/i18n";
import type { FirstStepView } from "@/lib/guide/first-steps";
import { buildNav, type NavRole, type NavSubject } from "@/lib/nav/places";
import { effectiveCapabilities } from "@/server/policy/capabilities";
import type { CurrentUser } from "@/server/auth";

const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;

const USER: CurrentUser = {
  id: "u1",
  email: "a@example.test",
  username: "a",
  name: "أحمد",
  locale: "ar",
  mustChangePassword: false,
  transparencyPending: false,
  tv: 0,
};

const STEPS: FirstStepView[] = [
  { id: "invite", titleKey: "guide.first.step.invite", hintKey: "guide.first.step.invite_hint", href: "/members", done: false, client: true, manual: false },
  { id: "space", titleKey: "guide.first.step.space", hintKey: "guide.first.step.space_hint", href: "/projects", done: false, client: true, manual: false },
];

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@/components/ui/toast";

const Queries = QueryClientProvider as unknown as FunctionComponent<{ client: QueryClient; children?: ReactNode }>;
const Toasts = ToastProvider as unknown as FunctionComponent<{ children?: ReactNode }>;

const html = (element: ReactElement): string => {
  const client = new QueryClient();
  client.setQueryData(["orgs"], { organizations: [] });
  client.setQueryData(["notifications"], { items: [], unreadCount: 0 });
  return renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(Queries, { client }, createElement(Toasts, null, element))));
};

describe("the first-steps card's state is in the first HTML (the `zk-fs` cookie)", () => {
  it("the cookie helpers: open, collapsed, hidden, and a bad value reads as open", () => {
    expect(parseFirstStepsCookie(null)).toBe("open");
    expect(parseFirstStepsCookie("collapsed")).toBe("collapsed");
    expect(parseFirstStepsCookie("hidden")).toBe("hidden");
    expect(parseFirstStepsCookie("anything")).toBe("open");
    expect(FIRST_STEPS_STATES).toEqual(["open", "collapsed", "hidden"]);
  });

  it("the cookie string: one year, the whole site, SameSite=Lax", () => {
    expect(firstStepsCookieString("collapsed")).toBe(`${FIRST_STEPS_COOKIE}=collapsed; path=/; max-age=31536000; SameSite=Lax`);
  });

  it("a card the server says is FOLDED is already folded in the server's HTML (no effect needed)", () => {
    const out = html(createElement(FirstStepsCardClient, { userId: "u1", steps: STEPS, initialCookieState: "collapsed" }));
    // the header with the title is there, the list of steps is not
    expect(out).toContain("aria-expanded=\"false\"");
    expect(out).not.toContain('id="first-steps-list"');
    expect(out).toContain("aria-controls=\"first-steps-list\"");
  });

  it("a card the server says is HIDDEN draws nothing at all on the server", () => {
    const out = html(createElement(FirstStepsCardClient, { userId: "u1", steps: STEPS, initialCookieState: "hidden" }));
    expect(out).not.toContain("first-steps-title");
    expect(out).not.toContain('aria-expanded');
  });

  it("the default is the open card, drawn at once (this was the jump: null until an effect)", () => {
    const out = html(createElement(FirstStepsCardClient, { userId: "u1", steps: STEPS }));
    expect(out).toContain("aria-expanded=\"true\"");
    expect(out).toContain('id="first-steps-list"');
  });

  it("the cookie state follows the card's own state: hidden wins, then folded", () => {
    expect(cookieStateOfLocal(null)).toBe("open");
    expect(cookieStateOfLocal({ dismissed: false, collapsed: true, done: [] })).toBe("collapsed");
    expect(cookieStateOfLocal({ dismissed: true, collapsed: false, done: [] })).toBe("hidden");
    expect(cookieStateOfLocal({ dismissed: true, collapsed: true, done: [] })).toBe("hidden");
  });
});

describe("the side menu's folded state is in the first frame (the `zk-sidebar` cookie)", () => {
  it("the cookie helpers: only «1» is folded", () => {
    expect(parseSidebarCookie(null)).toBe(false);
    expect(parseSidebarCookie("1")).toBe(true);
    expect(parseSidebarCookie("0")).toBe(false);
    expect(parseSidebarCookie("yes")).toBe(false);
  });

  it("AppShell with defaultCollapsed renders the 72px rail at once, and the width never animates on the first paint", () => {
    const subject: NavSubject = { role: "OWNER", caps: [...effectiveCapabilities({ role: "OWNER" })] };
    const out = html(
      createElement(AppShell, {
        user: USER,
        nav: buildNav(subject),
        rank: "OWNER" as NavRole,
        audience: "staff",
        isGuest: false,
        defaultCollapsed: true,
        children: createElement("p", null, "محتوى"),
      }),
    );
    const aside = /<aside[^>]*class="([^"]*)"/.exec(out)?.[1] ?? "";
    expect(aside.split(" ")).toContain("w-[72px]");
    // no width transition on the first paint (it would animate 256px → 72px after hydration)
    expect(aside).not.toContain("transition-[width]");
  });

  it("AppShell unfolded (the default) is the 236px menu of the adopted look", () => {
    const subject: NavSubject = { role: "OWNER", caps: [...effectiveCapabilities({ role: "OWNER" })] };
    const out = html(
      createElement(AppShell, {
        user: USER,
        nav: buildNav(subject),
        rank: "OWNER" as NavRole,
        audience: "staff",
        isGuest: false,
        children: createElement("p", null, "محتوى"),
      }),
    );
    expect(/<aside[^>]*class="([^"]*)"/.exec(out)?.[1]?.split(" ")).toContain("w-[236px]");
  });
});
