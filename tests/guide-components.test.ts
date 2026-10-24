import * as React from "react";
import { createElement, type FunctionComponent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The components are TSX; under vitest their JSX compiles to React.createElement, which needs a global React.
(globalThis as { React?: typeof React }).React = React;

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  usePathname: () => "/my-work",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
}));

import { GuideSearch } from "@/components/guide/guide-search";
import { HelpPanel, PageHelpButton } from "@/components/guide/page-help-button";
import { FirstStepsView } from "@/components/guide/first-steps-client";
import { HintView } from "@/components/guide/hint";
import { searchEntries } from "@/lib/guide/articles";
import { FIRST_STEPS, stepsFor, toViews } from "@/lib/guide/first-steps";
import { matchHelp } from "@/lib/guide/page-help";
import type { FirstStepsLocal } from "@/lib/guide/storage";
import { I18nProvider } from "@/lib/i18n";
import { getServerT } from "@/lib/i18n/server";

const { t } = getServerT();
const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const render = (element: ReactElement) => renderToStaticMarkup(createElement(Translations, { initial: "ar" }, element));
const noop = () => {};

/** Class names that would break right-to-left, or bypass the themes. */
function expectThemeSafe(html: string) {
  expect(html).not.toMatch(/\b(ml|mr|pl|pr|left|right)-\d/);
  expect(html).not.toMatch(/\b(text|bg|border|ring)-(red|green|blue|amber|emerald|sky|slate|gray|zinc|yellow|orange|violet|indigo|rose|teal|cyan|lime|purple|pink|fuchsia|black|white)\b/);
  expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
}

describe("GuideSearch", () => {
  const entries = searchEntries("staff");

  it("shows the search box with its label and every article as a link", () => {
    const html = render(createElement(GuideSearch, { entries }));
    expect(html).toContain('type="search"');
    expect(html).toContain(t("guide.search.label"));
    expect(html).toContain(t("guide.search.placeholder"));
    for (const e of entries) {
      expect(html).toContain(`href="/guide/${e.slug}"`);
      expect(html).toContain(e.title);
    }
    expect(html).not.toContain(t("guide.search.empty"));
    expectThemeSafe(html);
  });

  it("filters by what was typed, tolerant of spelling", () => {
    const html = render(createElement(GuideSearch, { entries, initialQuery: "مَهَمّة" }));
    expect(html).toContain('href="/guide/tasks"');
    expect(html).not.toContain('href="/guide/install"');
    expect(html).toContain(t("guide.search.clear"));
  });

  it("says so, kindly, when nothing matches", () => {
    const html = render(createElement(GuideSearch, { entries, initialQuery: "ززززززز" }));
    expect(html).toContain(t("guide.search.empty"));
    expect(html).not.toContain('href="/guide/');
  });

  it("marks the people article with the badge, and only that one", () => {
    const html = render(createElement(GuideSearch, { entries: searchEntries("managers") }));
    expect((html.match(new RegExp(t("guide.badge.managers"), "g")) ?? []).length).toBe(1);
  });

  it("keeps the input at 16px or more (so a phone does not zoom in) and the cards tall enough to tap", () => {
    const html = render(createElement(GuideSearch, { entries }));
    expect(html).toMatch(/<input[^>]*class="[^"]*\btext-base\b/);
    expect(html).toMatch(/<input[^>]*class="[^"]*\bh-12\b/);
  });
});

describe("PageHelpButton", () => {
  it("is a «؟» button that announces a dialog, closed at first, with an Arabic name", () => {
    const html = render(createElement(PageHelpButton, { pathname: "/my-work" }));
    expect(html).toContain("؟");
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain(`aria-label="${t("guide.help.open")}"`);
    expect(html).not.toContain('role="dialog"');
    expectThemeSafe(html);
  });

  it("is at least 44px square (a thumb can hit it)", () => {
    const html = render(createElement(PageHelpButton, { pathname: "/my-work" }));
    expect(html).toMatch(/\bsize-11\b/);
  });

  it("renders nothing on a page that has no help (no dead button)", () => {
    expect(render(createElement(PageHelpButton, { pathname: "/definitely-not-a-page" }))).toBe("");
    expect(render(createElement(PageHelpButton, { pathname: "/login" }))).toBe("");
  });

  it("lets the shell size and place it", () => {
    const html = render(createElement(PageHelpButton, { pathname: "/", className: "shell-slot" }));
    expect(html).toContain("shell-slot");
  });
});

describe("HelpPanel: «شو هاي الصفحة» and «الخطوة الجاية»", () => {
  const panel = (pathname: string, audience: "everyone" | "staff" | "managers", over: Record<string, unknown> = {}) => {
    const help = matchHelp(pathname);
    if (!help) throw new Error(`no help for ${pathname}`);
    return render(
      createElement(HelpPanel, { help: { ...help, ...over }, audience, titleId: "help-title", onClose: noop, onTour: noop }),
    );
  };

  it("is a modal dialog named by its heading", () => {
    const html = panel("/my-work", "staff");
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="help-title"');
    expect(html).toMatch(/id="help-title"/);
    expect(html).toContain(t("guide.help.title"));
  });

  it("shows the two lines under the owner's two headings", () => {
    const html = panel("/my-work", "staff");
    const help = matchHelp("/my-work")!;
    expect(html).toContain(t("guide.help.what"));
    expect(html).toContain(t("guide.help.next"));
    expect(html).toContain(t(help.whatKey));
    expect(html).toContain(t(help.nextKey));
    expect(html.indexOf(t("guide.help.what"))).toBeLessThan(html.indexOf(t("guide.help.next")));
  });

  it("gives a guest the read-only line instead of one that tells them to write", () => {
    const help = matchHelp("/tasks/x")!;
    const guest = panel("/tasks/x", "everyone");
    expect(guest).toContain(t(help.guestNextKey!));
    expect(guest).not.toContain(t(help.nextKey));
    const staff = panel("/tasks/x", "staff");
    expect(staff).toContain(t(help.nextKey));
    expect(staff).not.toContain(t(help.guestNextKey!));
  });

  it("offers «فرجيني» when the page has a tour, and not when it has none", () => {
    expect(panel("/my-work", "staff")).toContain(t("guide.help.tour"));
    expect(panel("/", "staff")).toContain(t("guide.help.tour"));
    expect(panel("/my-work", "staff", { tour: undefined })).not.toContain(t("guide.help.tour"));
  });

  it("links the article for the page when the viewer may read it, and the guide when not", () => {
    expect(panel("/my-work", "staff")).toContain('href="/guide/tasks"');
    expect(panel("/my-work", "everyone")).toContain('href="/guide"');
    expect(panel("/my-work", "everyone")).not.toContain('href="/guide/tasks"');
    expect(panel("/members", "managers")).toContain('href="/guide/team"');
    expect(panel("/members", "staff")).not.toContain('href="/guide/team"');
  });

  it("has a close button with an Arabic name, and says kindly when the tour could not start", () => {
    const html = panel("/my-work", "staff");
    expect(html).toContain(`aria-label="${t("guide.help.close")}"`);
    expect(html).not.toContain(t("guide.help.tour_unavailable"));
    const help = matchHelp("/my-work")!;
    const failed = render(
      createElement(HelpPanel, { help, audience: "staff", titleId: "x", onClose: noop, onTour: noop, tourFailed: true }),
    );
    expect(failed).toContain(t("guide.help.tour_unavailable"));
  });

  it("is a bottom sheet on a phone and a floating panel on a computer, with tall buttons and safe-area room", () => {
    const html = panel("/my-work", "staff");
    expect(html).toMatch(/\bmax-h-\[85dvh\]/);
    expect(html).toMatch(/\bmin-h-11\b/);
    expect(html).toContain("safe-area-inset-bottom");
    expectThemeSafe(html);
  });

  it("every page's panel renders for every audience without a missing string", () => {
    for (const pathname of ["/", "/chat", "/my-work", "/projects", "/projects/x", "/projects/x/timeline", "/boards/x", "/tasks/x", "/list", "/calendar", "/goals", "/ideas", "/production", "/departments", "/teams", "/members", "/files", "/crm", "/analytics", "/automation", "/telegram", "/settings", "/profile", "/u/x", "/guide", "/guide/tasks"]) {
      for (const audience of ["everyone", "staff", "managers"] as const) {
        const html = panel(pathname, audience);
        expect(html, `${pathname}/${audience}`).not.toMatch(/guide\.(page|help)\.[a-z-]+/);
      }
    }
  });
});

describe("FirstStepsView: «خطواتك الأولى»", () => {
  const fresh: FirstStepsLocal = { dismissed: false, collapsed: false, done: [] };
  const manager = (facts: Parameters<typeof toViews>[1] = {}) => toViews(stepsFor("managers"), facts);
  const view = (steps = manager(), local: FirstStepsLocal = fresh) =>
    render(createElement(FirstStepsView, { steps, local, onMark: noop, onCollapse: noop, onDismiss: noop }));

  it("lists every step with its title and a link to its page", () => {
    const html = view();
    for (const step of FIRST_STEPS) {
      expect(html, step.id).toContain(t(step.titleKey));
      expect(html, step.id).toContain(`href="${step.href}"`);
    }
    expect(html).toContain(t("guide.first.title"));
  });

  it("opens only the next step: its hint and its one primary button; the others are compact rows with the title alone", () => {
    const html = view(manager({ theme: true }));
    // the next step is the first one not done: «ضيف أول شخص»
    expect(html).toContain(t("guide.first.add-person.hint"));
    expect((html.match(new RegExp(`>${t("guide.first.go")}<`, "g")) ?? []).length).toBe(1);
    for (const id of ["review-spaces", "install", "first-task", "finish-task", "open-guide"]) {
      expect(html, id).not.toContain(t(`guide.first.${id}.hint`));
    }
    // ... and every other step still waiting is one tap from its page (the done one, the theme, has no link)
    for (const step of FIRST_STEPS.filter((s) => s.id !== "theme")) expect(html, step.id).toContain(`href="${step.href}"`);
    expect(html).not.toContain('href="/guide/themes"');
  });

  it("when the next step is done the next one opens (a person moves down the list as they go)", () => {
    // after the people, the spaces, the app and the theme, the chat's step comes next («ابعت أول رسالة بـ«عام»»)
    const html = view(manager({ people: true, spaces: true, theme: true }), { ...fresh, done: ["install"] });
    expect(html).toContain(t("guide.first.first-message.hint"));
    expect(html).not.toContain(t("guide.first.add-person.hint"));
    expect((html.match(new RegExp(`>${t("guide.first.go")}<`, "g")) ?? []).length).toBe(1);
  });

  it("carries the tour hook for «خطواتك الأولى»", () => {
    expect(view()).toContain('data-tour="first-steps"');
  });

  it("shows how far along the person is, as a number and as a bar a screen reader can read", () => {
    const html = view(manager({ theme: true, "task-created": true }));
    expect(html).toContain(t("guide.first.progress", { done: 2, total: 8 }));
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="2"');
    expect(html).toContain('aria-valuemax="8"');
  });

  it("draws a done step differently — a check, the word «تمّت», no link, no button — and a waiting one with «لسا»", () => {
    const html = view(manager({ theme: true }));
    const themeRow = html.split("<li").find((chunk) => chunk.includes(t("guide.first.theme.title")))!;
    expect(themeRow).toContain(t("guide.first.done_sr"));
    expect(themeRow).not.toContain("<a ");
    expect(themeRow).not.toContain("<button");
    const guideRow = html.split("<li").find((chunk) => chunk.includes(t("guide.first.open-guide.title")))!;
    expect(guideRow).toContain(t("guide.first.todo_sr"));
    expect(guideRow).toContain('href="/guide"');
  });

  it("a waiting step that is not the next one is a whole-row link at least 48px tall", () => {
    const html = view(manager());
    const row = html.split("<li").find((chunk) => chunk.includes(t("guide.first.open-guide.title")))!;
    expect(row).toMatch(/<a [^>]*class="[^"]*\bmin-h-12\b/);
  });

  it("only the install step has the manual «تم» button, named after its step — as the next step or as a compact row", () => {
    const html = view();
    const installRow = html.split("<li").find((chunk) => chunk.includes(t("guide.first.install.title")))!;
    expect(installRow).toContain(`>${t("guide.first.mark")}<`);
    expect(installRow).toContain(t("guide.first.mark_aria", { title: t("guide.first.install.title") }));
    expect((html.match(new RegExp(`>${t("guide.first.mark")}<`, "g")) ?? []).length).toBe(1);
    // when install IS the next step (a plain member) it opens, with «ابدأ» and «تم» together
    const staff = render(
      createElement(FirstStepsView, { steps: toViews(stepsFor("staff"), {}), local: fresh, onMark: noop, onCollapse: noop, onDismiss: noop }),
    );
    expect(staff).toContain(t("guide.first.install.hint"));
    expect(staff).toContain(`>${t("guide.first.mark")}<`);
    expect((staff.match(new RegExp(`>${t("guide.first.mark")}<`, "g")) ?? []).length).toBe(1);
  });

  it("remembers what the device remembers: the installed step shows as done", () => {
    const html = view(manager(), { ...fresh, done: ["install"] });
    const installRow = html.split("<li").find((chunk) => chunk.includes(t("guide.first.install.title")))!;
    expect(installRow).toContain(t("guide.first.done_sr"));
    expect(installRow).not.toContain(`>${t("guide.first.mark")}<`);
    expect(installRow).not.toContain("<a ");
  });

  it("collapses to its header: the progress and the way back, but no list", () => {
    const html = view(manager({ theme: true }), { ...fresh, collapsed: true });
    expect(html).toContain(t("guide.first.title"));
    expect(html).toContain(t("guide.first.progress", { done: 1, total: 8 }));
    expect(html).toContain(t("guide.first.expand"));
    expect(html).not.toContain(t("guide.first.first-task.title"));
    expect(html).not.toContain("<li");
    expect(html).not.toContain(t("guide.first.go"));
  });

  it("offers to collapse and to dismiss, with Arabic names, when open", () => {
    const html = view();
    expect(html).toContain(t("guide.first.collapse"));
    expect(html).toContain(t("guide.first.dismiss"));
    expect(html).toContain('aria-expanded="true"');
  });

  it("is gone when it was dismissed on this device", () => {
    expect(view(manager(), { ...fresh, dismissed: true })).toBe("");
  });

  it("is gone when everything is done", () => {
    const all = toViews(stepsFor("staff"), { theme: true, "task-created": true, "task-completed": true, "message-sent": true });
    expect(view(all, { ...fresh, done: ["install", "open-guide"] })).toBe("");
    // one step left and it stays
    expect(view(all, { ...fresh, done: ["install"] })).not.toBe("");
  });

  it("is gone when there is nothing to show", () => {
    expect(view([])).toBe("");
  });

  it("gives a guest only the steps that apply to them", () => {
    const html = view(toViews(stepsFor("everyone"), {}));
    expect(html).toContain(t("guide.first.install.title"));
    expect(html).toContain(t("guide.first.theme.title"));
    expect(html).toContain(t("guide.first.open-guide.title"));
    expect(html).not.toContain(t("guide.first.first-task.title"));
    expect(html).not.toContain(t("guide.first.add-person.title"));
  });

  it("keeps its buttons and rows tall enough to tap and uses the themes and logical spacing only", () => {
    const html = view();
    expect(html).toMatch(/\bmin-h-11\b/);
    expect(html).toMatch(/\bmin-h-12\b/);
    expectThemeSafe(html);
  });
});

describe("HintView: a tip, once", () => {
  it("is a note with the words and one «فهمت» button", () => {
    const html = render(createElement(HintView, { onDismiss: noop }, "ضغطة مطوّلة على الرسالة بتحوّلها لمهمة"));
    expect(html).toContain('role="note"');
    expect(html).toContain("ضغطة مطوّلة على الرسالة بتحوّلها لمهمة");
    expect(html).toContain(t("guide.hint.dismiss"));
    expect(html).toMatch(/\bmin-h-11\b/);
    expectThemeSafe(html);
  });
});
