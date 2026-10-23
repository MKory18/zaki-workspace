import * as React from "react";
import { createElement, type FunctionComponent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ThemeDecor } from "@/components/theme/theme-decor";
import { ArtSlot } from "@/components/theme/art-slot";
import { DoorShell } from "@/components/theme/door-shell";
import { AuthForm } from "@/components/auth-form";
import { OnboardingForm } from "@/components/onboarding-form";
import { Badge, Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { I18nProvider } from "@/lib/i18n";
import { getServerT } from "@/lib/i18n/server";
import {
  ART_AVAILABLE,
  ART_SCENES,
  ART_SLOTS,
  DECOR_HIDDEN_ATTR,
  DECOR_KINDS,
  artStateOf,
  artUrl,
  decorClass,
  isArtSlot,
  watchDecorVisibility,
  type VisibilityTarget,
} from "@/lib/themes/decor";
import { read, stripComments } from "./themes-decor-helpers";

// The components are TSX; under vitest their JSX compiles to React.createElement, which needs a global React.
(globalThis as { React?: typeof React }).React = React;

const { t } = getServerT();
const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const render = (element: ReactElement): string => renderToStaticMarkup(createElement(Translations, { initial: "ar" }, element));
const bare = (element: ReactElement): string => renderToStaticMarkup(element);

/** The visible text of a markup: tags and entities out. */
const textOf = (markup: string): string =>
  markup
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Latin words in the visible text: the brand name is the only English allowed on a screen. */
const latinWords = (markup: string): string[] => textOf(markup).match(/[A-Za-z]{2,}/g) ?? [];

describe("<ThemeDecor /> — one aria-hidden layer, all behaviour in the stylesheet", () => {
  for (const kind of DECOR_KINDS) {
    it(`kind="${kind}": a div the screen reader skips, with the layer classes and nothing else on it`, () => {
      const html = bare(createElement(ThemeDecor, { kind }));
      expect(html).toMatch(new RegExp(`^<div aria-hidden="true" class="zk-decor zk-decor-${kind}">`));
      expect(html).not.toContain("onclick");
      expect(decorClass(kind)).toBe(`zk-decor zk-decor-${kind}`);
    });
  }

  it("— there are four places, and exactly four", () => {
    expect([...DECOR_KINDS]).toEqual(["door", "empty", "sidebar", "strip"]);
  });

  it("— the door carries two more empty layers (the left corner and the skyline); no other place does", () => {
    expect(bare(createElement(ThemeDecor, { kind: "door" }))).toContain('<i class="zk-decor-l"></i><i class="zk-decor-b"></i>');
    for (const kind of ["empty", "sidebar", "strip"] as const) expect(bare(createElement(ThemeDecor, { kind })), kind).not.toContain("<i");
  });

  it("— it is a server component: no hooks, no client directive, and it brings the stylesheet with it", () => {
    const src = read("src", "components", "theme", "theme-decor.tsx");
    const code = stripComments(src);
    expect(src).not.toMatch(/["']use client["']/);
    expect(code).not.toMatch(/\buse(State|Effect|LayoutEffect|Ref|Memo|Callback|Context|Reducer)\b/);
    expect(code).toContain('import "./decor.css"');
  });

  it("— the pause for a hidden tab is a client leaf mounted by the layer, so no page has to remember it", () => {
    const leaf = read("src", "components", "theme", "decor-visibility.tsx");
    expect(leaf).toMatch(/^["']use client["']/);
    expect(stripComments(leaf)).toContain("watchDecorVisibility(document)");
    expect(stripComments(read("src", "components", "theme", "theme-decor.tsx"))).toContain("<DecorVisibility");
  });
});

describe("watchDecorVisibility — a hidden tab pauses the motion, and several layers share one watcher", () => {
  /** A document that only knows what the watcher uses, and lets the test fire the event. */
  function fakeDocument(hidden = false) {
    const attrs = new Map<string, string>();
    const listeners = new Set<() => void>();
    const doc = {
      hidden,
      documentElement: {
        setAttribute: (name: string, value: string) => void attrs.set(name, value),
        removeAttribute: (name: string) => void attrs.delete(name),
      },
      addEventListener: (_type: "visibilitychange", fn: () => void) => void listeners.add(fn),
      removeEventListener: (_type: "visibilitychange", fn: () => void) => void listeners.delete(fn),
    };
    return {
      doc: doc as VisibilityTarget & { hidden: boolean },
      attrs,
      listeners,
      fire: () => listeners.forEach((fn) => fn()),
    };
  }

  it("— sets the attribute while the tab is hidden and removes it when it is shown again", () => {
    const { doc, attrs, fire } = fakeDocument(false);
    const stop = watchDecorVisibility(doc);
    expect(attrs.has(DECOR_HIDDEN_ATTR)).toBe(false);
    doc.hidden = true;
    fire();
    expect(attrs.get(DECOR_HIDDEN_ATTR)).toBe("1");
    doc.hidden = false;
    fire();
    expect(attrs.has(DECOR_HIDDEN_ATTR)).toBe(false);
    stop();
  });

  it("— a tab that is already hidden when the first layer mounts is paused straight away", () => {
    const { doc, attrs } = fakeDocument(true);
    const stop = watchDecorVisibility(doc);
    expect(attrs.get(DECOR_HIDDEN_ATTR)).toBe("1");
    stop();
  });

  it("— two layers share ONE listener; the first to go does not take the other's pause away", () => {
    const { doc, attrs, listeners, fire } = fakeDocument(false);
    const a = watchDecorVisibility(doc);
    const b = watchDecorVisibility(doc);
    expect(listeners.size, "one listener for two layers").toBe(1);
    doc.hidden = true;
    fire();
    a();
    expect(listeners.size, "still watching for the layer that is left").toBe(1);
    expect(attrs.get(DECOR_HIDDEN_ATTR)).toBe("1");
    b();
    expect(listeners.size, "the last layer removes the listener").toBe(0);
    expect(attrs.has(DECOR_HIDDEN_ATTR), "and leaves no attribute behind").toBe(false);
  });

  it("— stopping twice is harmless (React strict mode mounts, unmounts and mounts again)", () => {
    const { doc, listeners } = fakeDocument(false);
    const first = watchDecorVisibility(doc);
    first();
    first();
    const second = watchDecorVisibility(doc);
    expect(listeners.size).toBe(1);
    second();
    expect(listeners.size).toBe(0);
  });

  it("— the attribute is the one the stylesheet pauses on", () => {
    expect(DECOR_HIDDEN_ATTR).toBe("data-decor-hidden");
  });
});

describe("<ArtSlot /> — the owner's artwork arrives later; until then the page shows no broken image", () => {
  it("— the slot names are the twelve of the owner's prompt list, lower-case, and nothing else", () => {
    expect([...ART_SLOTS]).toEqual([
      "login-door",
      "today-strip",
      "empty-chat",
      "empty-tasks",
      "empty-library",
      "empty-inbox",
      "empty-search",
      "guide-welcome",
      "guide-spaces",
      "guide-message-to-task",
      "guide-notifications",
      "guide-install-app",
    ]);
    for (const slot of ART_SLOTS) expect(slot).toMatch(/^[a-z]+(-[a-z]+)*$/);
    // the two that are a scene (a night gate, a skyline) rather than an object on a tile
    expect([...ART_SCENES]).toEqual(["login-door", "today-strip"]);
  });

  it("— the file is /brand/art/<slot>.webp, and a name that is not a slot is refused (it goes into a URL)", () => {
    expect(artUrl("empty-chat")).toBe("/brand/art/empty-chat.webp");
    for (const bad of ["../secret", "empty-chat.webp", "EMPTY-CHAT", "", "empty chat", "login-door/../x", 5, null, undefined]) {
      expect(isArtSlot(bad), String(bad)).toBe(false);
    }
    for (const good of ART_SLOTS) expect(isArtSlot(good)).toBe(true);
  });

  it("— with a shipped file it renders an img: no alt text (it is decoration), lazy, decoded off the main thread, marked with its slot and state", () => {
    // no artwork has shipped yet (WP-UI2 item 5), so the picture is hidden at the source: assert
    // the slot is ABSENT from ART_AVAILABLE and, with it temporarily listed, that the <img> is right
    expect(ART_AVAILABLE.includes("empty-chat")).toBe(false);
    const withArt = ART_AVAILABLE as string[];
    withArt.push("empty-chat");
    try {
      const html = bare(createElement(ArtSlot, { slot: "empty-chat", className: "max-h-36" }));
      expect(html).toContain('src="/brand/art/empty-chat.webp"');
      expect(html).toContain('alt=""');
      expect(html).toContain('loading="lazy"');
      expect(html).toContain('decoding="async"');
      expect(html).toContain('data-art-slot="empty-chat"');
      expect(html).toContain('data-state="loading"');
      expect(html).toMatch(/class="zk-art max-h-36"/);
    } finally {
      withArt.pop();
    }
  });

  it("— a slot that is not agreed renders nothing at all", () => {
    expect(bare(createElement(ArtSlot, { slot: "somewhere-else" }))).toBe("");
    expect(bare(createElement(ArtSlot, { slot: "../../etc/passwd" }))).toBe("");
  });

  it("— artStateOf says what the browser knows about an image: loading, loaded or failed", () => {
    expect(artStateOf(null)).toBe("loading");
    expect(artStateOf({ complete: false, naturalWidth: 0 })).toBe("loading");
    expect(artStateOf({ complete: true, naturalWidth: 0 }), "complete with no size = a 404 or an undecodable file").toBe("failed");
    expect(artStateOf({ complete: true, naturalWidth: 1024 })).toBe("loaded");
  });

  it("— it hides itself on error, and also catches the error that came BEFORE hydration (the server's img can fail early)", () => {
    const src = read("src", "components", "theme", "art-slot.tsx");
    const code = stripComments(src);
    expect(src).toMatch(/^["']use client["']/);
    expect(code).toContain("onError={() => setState(\"failed\")}");
    expect(code).toContain("onLoad={() => setState(\"loaded\")}");
    // the mount-time check: an error that fired before React attached its listener is not replayed
    expect(code).toMatch(/useEffect\(\(\) => \{[\s\S]*artStateOf\(ref\.current\)/);
    expect(code).toMatch(/state === "failed"[\s\S]*return null/);
  });
});

describe("<EmptyState /> — the old props still work; art and a next step are new", () => {
  it("— title, hint and children render exactly as before (every existing caller)", () => {
    const html = bare(createElement(EmptyState, { title: "لا مشاريع", hint: "أنشئ مشروعاً" }, createElement("button", null, "زر")));
    expect(html).toContain("لا مشاريع");
    expect(html).toContain("أنشئ مشروعاً");
    expect(html).toContain("<button>زر</button>");
    expect(html).not.toContain("<img");
    expect(html, "no action given: no link").not.toContain("<a ");
  });

  it("— draws the decoration layer behind the words, and the words above it", () => {
    const html = bare(createElement(EmptyState, { title: "لا مهام" }));
    expect(html).toContain('<div aria-hidden="true" class="zk-decor zk-decor-empty">');
    expect(html.indexOf("zk-decor-empty"), "the layer comes first, the words after it").toBeLessThan(html.indexOf("لا مهام"));
    expect(html).toMatch(/class="[^"]*\brelative\b[^"]*"/);
    expect(html).toMatch(/class="[^"]*\boverflow-hidden\b[^"]*"/);
    expect(html).toMatch(/class="[^"]*\bz-10\b[^"]*"/);
  });

  it("— `art` puts the slot's picture above the title (once that slot's file has shipped)", () => {
    expect(ART_AVAILABLE.includes("empty-chat")).toBe(false);
    const withArt = ART_AVAILABLE as string[];
    withArt.push("empty-chat");
    try {
      const html = bare(createElement(EmptyState, { title: "لا رسائل", art: "empty-chat" }));
      expect(html).toContain('src="/brand/art/empty-chat.webp"');
      expect(html.indexOf("<img")).toBeLessThan(html.indexOf("لا رسائل"));
    } finally {
      withArt.pop();
    }
  });

  it("— an unknown `art` is ignored (no broken image, no crash)", () => {
    const html = bare(createElement(EmptyState, { title: "x", art: "nope" }));
    expect(html).not.toContain("<img");
  });

  it("— `action` is a button-link: no dead end, every empty page says the next step", () => {
    const html = bare(createElement(EmptyState, { title: "لا ملفات", action: { label: "ارفع ملفاً", href: "/files" } }));
    expect(html).toMatch(/<a [^>]*href="\/files"[^>]*>ارفع ملفاً<\/a>/);
    // a tap target the size of a thumb
    expect(html).toMatch(/<a [^>]*class="[^"]*\bmin-h-11\b/);
  });

  it("— the other exports of the file still render what they are given", () => {
    expect(bare(createElement(Card, { className: "x", children: "c" }))).toMatch(/^<div class="[^"]*\bx\b[^"]*">c<\/div>$/);
    expect(bare(createElement(CardHeader, null, "h"))).toMatch(/>h<\/div>$/);
    expect(bare(createElement(CardBody, null, "b"))).toMatch(/>b<\/div>$/);
    expect(bare(createElement(Badge, { color: "#fff", children: "badge" }))).toContain("badge");
  });
});

describe("the door — login, first-run set-up and the onboarding on the same calm door", () => {
  const door = (...children: ReactNode[]) => render(createElement(DoorShell, null, ...children));

  it("— the Zaki Workspace mark and wordmark, a decoration layer behind, the picture slot, the content above", () => {
    const html = door(createElement("p", null, "المحتوى"));
    expect(html).toMatch(/^<main /);
    expect(html).toContain('class="zk-decor zk-decor-door"');
    // no artwork has shipped yet (WP-UI2 item 5): the door's picture slot is EMPTY — the ornament
    // layer carries the door until the owner drops `login-door.webp` into public/brand/art/
    expect(html).not.toContain("data-art-slot");
    expect(html).toContain("zk-door-column");
    expect(t("app.name")).toBe("Zaki Workspace");
    // the decoration comes first in the document, the content column after it: positioned siblings paint in order
    expect(html.indexOf("zk-decor-door")).toBeLessThan(html.indexOf("zk-door-column"));
    // the old English wordmark is gone from the door (the mark is hidden from assistive technology, see below)
    expect(textOf(html)).not.toMatch(/Zakai|Intelligent/);
  });

  it("— the mark is hidden from assistive technology (the wordmark says the name once)", () => {
    const html = door();
    expect(html).toMatch(/<span aria-hidden="true"><svg [^>]*aria-label="[^"]*"/);
    expect(html).toContain('lang="en"');
  });

  it("— phone first: 16 px gutters, never wider than the screen, at least as tall as it", () => {
    // measured in a real browser at 375 px: no sideways scroll on any door page in any theme (scrollWidth = 375)
    const main = /<main\b[^>]*>/.exec(door())?.[0] ?? "";
    for (const cls of ["px-4", "overflow-hidden", "min-h-dvh", "w-full"]) {
      if (cls === "w-full") expect(door(), cls).toMatch(/class="zk-door-column[^"]*\bw-full\b/);
      else expect(main, cls).toMatch(new RegExp(`\\b${cls}\\b`));
    }
  });

  it("— a wide door for the onboarding, a narrow one for sign-in", () => {
    expect(render(createElement(DoorShell, { width: "md" }))).toContain("max-w-md");
    expect(render(createElement(DoorShell, null))).toContain("max-w-sm");
  });
});

describe("sign-in and first-run set-up", () => {
  const login = () => render(createElement(AuthForm, { mode: "login" }));
  const register = () => render(createElement(AuthForm, { mode: "register" }));

  it("— sign-in keeps every field, name and behaviour hook", () => {
    const html = login();
    expect(html).toContain(t("auth.login"));
    expect(html).toContain('name="identifier"');
    expect(html).toContain('name="password"');
    expect(html).toContain('autoComplete="username"');
    expect(html).toContain('autoComplete="current-password"');
    expect(html).toContain(t("login.identifier"));
    expect(html).toContain(t("auth.password"));
    expect(html).toContain(t("auth.submitLogin"));
    expect(html).toContain(t("login.no_account"));
    expect(html).toContain('type="submit"');
    expect(html, "no error until something fails").not.toContain('role="alert"');
  });

  it("— the register link is always visible and is a tap target a thumb can hit", () => {
    const html = login();
    expect(html).toMatch(new RegExp(`<a [^>]*href="/register"[^>]*>${t("login.register_link")}</a>`));
    expect(/<a\b[^>]*href="\/register"[^>]*>/.exec(html)?.[0]).toMatch(/\bmin-h-11\b/);
  });

  it("— the first-run set-up keeps its five fields, the hint and the way back", () => {
    const html = register();
    for (const name of ["orgName", "name", "jobTitle", "email", "password"]) expect(html, name).toContain(`name="${name}"`);
    expect(html).toContain(t("bootstrap.title"));
    expect(html).toContain(t("bootstrap.hint"));
    expect(html).toContain(t("auth.passwordRule"));
    expect(html).toContain(t("auth.submitRegister"));
    expect(html).toMatch(new RegExp(`<a [^>]*href="/login"[^>]*>${t("auth.haveAccount")}</a>`));
    expect(/<a\b[^>]*href="\/login"[^>]*>/.exec(html)?.[0]).toMatch(/\bmin-h-11\b/);
    expect(html).toContain('minLength="8"');
  });

  it("— both sit on the door: the layer, the picture slot, the wordmark; no English but the brand", () => {
    for (const html of [login(), register()]) {
      expect(html).toContain("zk-decor-door");
      // no artwork has shipped yet (WP-UI2 item 5): the picture slot is empty, the layer carries the door
      expect(html).not.toContain("data-art-slot");
      expect(latinWords(html).join(" ")).toBe("Zaki Workspace");
      expect(html).toContain('<h1 ');
    }
  });

  it("— the form is a card on the door, the fields are a thumb tall", () => {
    const html = login();
    // (whatever order the primitives write their attributes in: the tag is found by its name, then read whole)
    const field = /<input\b[^>]*\bname="identifier"[^>]*>/.exec(html)?.[0] ?? "";
    expect(field, "the identifier field").toMatch(/class="[^"]*\bh-11\b/);
    const submit = /<button\b[^>]*\btype="submit"[^>]*>/.exec(html)?.[0] ?? "";
    expect(submit, "the submit button").toMatch(/class="[^"]*\bh-11\b/);
  });
});

describe("the onboarding — a new password, then the notice", () => {
  const onboarding = (props: { owesPassword: boolean; owesNotice: boolean }) =>
    render(createElement(OnboardingForm, { name: "منار", next: "/", ...props }));

  it("— both owed: the password step first, with its fields, the step counter and the greeting", () => {
    const html = onboarding({ owesPassword: true, owesNotice: true });
    expect(html).toContain(t("onboarding.welcome", { name: "منار" }));
    expect(html).toContain(t("onboarding.password_title"));
    for (const name of ["currentPassword", "newPassword", "confirmPassword"]) expect(html, name).toContain(`name="${name}"`);
    expect(html).toContain(t("onboarding.step", { current: 1, total: 2 }));
    expect(html).toContain(t("onboarding.show_passwords"));
    expect(html).toContain(t("onboarding.password_submit"));
    expect(html).toContain(t("common.logout"));
  });

  it("— only the notice owed: the four points and the one button, no password field", () => {
    const html = onboarding({ owesPassword: false, owesNotice: true });
    expect(html).toContain(t("onboarding.notice_title"));
    for (const key of ["onboarding.notice_kept", "onboarding.notice_archive", "onboarding.notice_work", "onboarding.notice_record"]) expect(html, key).toContain(t(key));
    expect(html).toContain(t("onboarding.notice_accept"));
    expect(html).not.toContain('name="currentPassword"');
  });

  it("— it is on the same door, wider, with the sign-out under the card, and no English but the brand", () => {
    for (const owes of [{ owesPassword: true, owesNotice: true }, { owesPassword: false, owesNotice: true }]) {
      const html = onboarding(owes);
      expect(html).toContain("zk-decor-door");
      expect(html).toContain("max-w-md");
      expect(latinWords(html).join(" ")).toBe("Zaki Workspace");
      expect(textOf(html), "no old wordmark").not.toMatch(/Zakai|Intelligent/);
      expect(html.indexOf(t("common.logout")), "the sign-out is under the card").toBeGreaterThan(html.indexOf(t("onboarding.welcome", { name: "منار" })));
      const end = html.indexOf(`>${t("common.logout")}</button>`);
      const tag = html.slice(html.lastIndexOf("<button", end), end + 1);
      expect(tag, "the sign-out is a tap target a thumb can hit").toMatch(/\bmin-h-11\b/);
    }
  });
});
