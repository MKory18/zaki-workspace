import * as React from "react";
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The pages are TSX; under vitest their JSX compiles to React.createElement, which needs a global React.
(globalThis as { React?: typeof React }).React = React;

/**
 * The old links must never end on Next's built-in English page. Four files make that true:
 *
 *   src/app/not-found.tsx           an address that matches no page (root layout: theme + dictionary, no shell)
 *   src/app/(app)/not-found.tsx     notFound() inside the app (the shell stays around it)
 *   src/app/(app)/error.tsx         a page that fails while it renders (the shell stays around it)
 *   src/app/global-error.tsx        the layout itself failed: nothing of the app is left, not even its stylesheet
 *
 * They are rendered here the way Next renders them (react-dom/server), because "an Arabic sentence and a
 * way out" is exactly what a visitor of a dead link needs.
 */

const mocked = vi.hoisted(() => ({
  refresh: vi.fn(),
  /** The props of every <Button> the error page drew (the stub below records them so a test can press one). */
  buttons: [] as { onClick?: () => void; disabled?: boolean; children?: unknown }[],
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: mocked.refresh }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

vi.mock("@/components/ui/button", () => ({
  Button: (props: { onClick?: () => void; disabled?: boolean; className?: string; children?: ReactNode }) => {
    mocked.buttons.push(props);
    return createElement("button", { type: "button", className: props.className, disabled: props.disabled }, props.children);
  },
}));

import RootNotFound from "@/app/not-found";
import AppNotFound from "@/app/(app)/not-found";
import AppError from "@/app/(app)/error";
import GlobalError from "@/app/global-error";
import { AR } from "@/lib/i18n/dict";
import { render, classTokens, PALETTE_COLOUR, PHYSICAL_UTILITY } from "./ui-render";

const ARABIC_LETTER = /[؀-ۿ]/;
const LATIN_WORD = /[A-Za-z]{2,}/;

/** What a person reads: the head and the style sheet are not text, tags are not text. */
function visibleText(markup: string): string {
  return markup
    .replace(/<head[\s\S]*?<\/head>/g, " ")
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Every <a href="..."> of a piece of markup, with its text. */
function links(markup: string): { href: string; text: string; classes: string[] }[] {
  return [...markup.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map((m) => ({
    href: /\bhref="([^"]*)"/.exec(m[1] ?? "")?.[1] ?? "",
    text: visibleText(m[2] ?? ""),
    classes: (/\bclass="([^"]*)"/.exec(m[1] ?? "")?.[1] ?? "").split(/\s+/).filter(Boolean),
  }));
}

/**
 * The failure a visitor must never be shown: a message, a stack, a hash. The connection string's host is a reserved
 * documentation name (`.example`, RFC 2606), so `npm run scan:secrets` knows the credential is a fixture; its
 * password stays a real-looking one, because the leak check below looks for exactly that word.
 */
function secretError(): Error & { digest?: string } {
  const error: Error & { digest?: string } = new Error("SECRET connection to postgres://admin:hunter2@db.example:5432 refused");
  error.stack = "Error: SECRET\n    at loadTasks (C:/app/src/server/services/tasks.ts:42:11)";
  error.digest = "d1g3st-77aa";
  return error;
}

function expectNoLeak(markup: string) {
  for (const leaked of ["SECRET", "hunter2", "postgres", "loadTasks", "tasks.ts", "d1g3st", "digest"]) {
    expect(markup, leaked).not.toContain(leaked);
  }
}

beforeEach(() => {
  mocked.buttons.length = 0;
  mocked.refresh.mockClear();
});

describe("the root «not found» (an address that matches no page)", () => {
  const markup = render(createElement(RootNotFound));

  it("says in Arabic that the page is not there or is not yours — one sentence for both, so a stranger learns nothing", () => {
    expect(visibleText(markup)).toContain(AR["errpage.notfound.title"]);
    expect(AR["errpage.notfound.title"]).toBe("الصفحة غير موجودة أو ما عندك صلاحية عليها");
    expect(visibleText(markup)).toContain(AR["errpage.notfound.hint"]);
    expect(markup).toMatch(/<h1\b/);
  });

  it("is all Arabic: no Latin word, none of Next's built-in English", () => {
    const text = visibleText(markup);
    expect(text).toMatch(ARABIC_LETTER);
    expect(text).not.toMatch(LATIN_WORD);
    expect(text).not.toMatch(/404|could not be found|This page/i);
  });

  it("offers a way out: a link to the home page, big enough to tap", () => {
    const home = links(markup).filter((l) => l.href === "/");
    expect(home).toHaveLength(1);
    expect(home[0]?.text).toBe(AR["errpage.home"]);
    expect(home[0]?.classes).toContain("min-h-11");
  });

  it("is drawn with theme tokens and logical properties only", () => {
    const tokens = classTokens(markup);
    expect(tokens.filter((c) => PALETTE_COLOUR.test(c) || PHYSICAL_UTILITY.test(c))).toEqual([]);
    expect(tokens).toContain("text-fg");
  });
});

describe("the «not found» of the app (notFound() inside the shell)", () => {
  const markup = render(createElement(AppNotFound));

  it("says «الصفحة غير موجودة أو ما عندك صلاحية عليها» and sends the visitor to the Today page", () => {
    const text = visibleText(markup);
    expect(text).toContain("الصفحة غير موجودة أو ما عندك صلاحية عليها");
    const home = links(markup).filter((l) => l.href === "/");
    expect(home).toHaveLength(1);
    expect(home[0]?.text).toBe("ارجع لصفحة اليوم");
    expect(home[0]?.classes).toContain("min-h-11");
  });

  it("is all Arabic and has a heading", () => {
    const text = visibleText(markup);
    expect(text).not.toMatch(LATIN_WORD);
    expect(markup).toMatch(/<h1\b/);
  });

  it("leaves the page landmark to the shell (a second <main> inside the shell's <main> is invalid)", () => {
    expect(markup).not.toMatch(/<main\b/);
  });

  it("is drawn with theme tokens and logical properties only", () => {
    const tokens = classTokens(markup);
    expect(tokens.filter((c) => PALETTE_COLOUR.test(c) || PHYSICAL_UTILITY.test(c))).toEqual([]);
  });
});

describe("the error page of the app (a page failed while it was drawn)", () => {
  const props = () => ({ error: secretError(), reset: vi.fn() });

  it("says what happened and what to do, together: ⚠️ with the words, 🔧 with the way out", () => {
    const markup = render(createElement(AppError, props()));
    const text = visibleText(markup);
    expect(text).toContain(AR["errpage.error.title"]);
    expect(text).toContain(AR["errpage.error.warn"]);
    expect(text).toContain(AR["errpage.error.fix"]);
    expect(markup).toContain("⚠️");
    expect(markup).toContain("🔧");
    expect(markup.indexOf("⚠️")).toBeLessThan(markup.indexOf("🔧"));
  });

  it("is all Arabic", () => {
    const text = visibleText(render(createElement(AppError, props())));
    expect(text).toMatch(ARABIC_LETTER);
    expect(text).not.toMatch(LATIN_WORD);
  });

  it("never prints the error: not the message, not the stack, not the digest", () => {
    expectNoLeak(render(createElement(AppError, props())));
  });

  it("offers «جرّب مرة ثانية» and a link home (big enough to tap)", () => {
    const markup = render(createElement(AppError, props()));
    expect(visibleText(markup)).toContain("جرّب مرة ثانية");
    const retry = mocked.buttons.find((b) => String(b.children) === AR["errpage.retry"]);
    expect(retry, "a button with the retry label").toBeTruthy();
    const home = links(markup).filter((l) => l.href === "/");
    expect(home).toHaveLength(1);
    expect(home[0]?.text).toBe(AR["errpage.home"]);
    expect(home[0]?.classes).toContain("min-h-11");
  });

  it("the retry button calls reset() — and asks the server again first, because the failure may have been the server's", () => {
    const p = props();
    render(createElement(AppError, p));
    const retry = mocked.buttons.find((b) => String(b.children) === AR["errpage.retry"]);
    expect(retry?.onClick).toBeTypeOf("function");
    expect(p.reset).not.toHaveBeenCalled();
    retry?.onClick?.();
    expect(mocked.refresh).toHaveBeenCalledTimes(1);
    expect(p.reset).toHaveBeenCalledTimes(1);
  });

  it("is drawn with theme tokens and logical properties only, and does not open a second <main>", () => {
    const markup = render(createElement(AppError, props()));
    const tokens = classTokens(markup);
    expect(tokens.filter((c) => PALETTE_COLOUR.test(c) || PHYSICAL_UTILITY.test(c))).toEqual([]);
    expect(markup).not.toMatch(/<main\b/);
  });
});

describe("the global error (the layout itself failed: no shell, no stylesheet, no providers)", () => {
  const props = () => ({ error: secretError(), reset: vi.fn() });
  const markup = renderToStaticMarkup(createElement(GlobalError, props()));

  it("is a whole document of its own — Next replaces the root layout with it — in Arabic and right to left", () => {
    expect(markup).toMatch(/^<html\b[^>]*\blang="ar"/);
    expect(markup).toMatch(/^<html\b[^>]*\bdir="rtl"/);
    expect(markup).toMatch(/<body\b/);
    expect(markup).toContain("</html>");
  });

  it("carries static Arabic text from the dictionary and no Latin word at all", () => {
    const text = visibleText(markup);
    expect(text).toContain(AR["errpage.global.title"]);
    expect(text).toContain(AR["errpage.global.warn"]);
    expect(text).toContain(AR["errpage.global.fix"]);
    expect(text).not.toMatch(LATIN_WORD);
    // the tab title is Arabic too
    expect(/<title>([\s\S]*?)<\/title>/.exec(markup)?.[1]).toBe(AR["errpage.global.doc_title"]);
  });

  it("shows ⚠️ and 🔧 together, and never prints the error", () => {
    expect(markup).toContain("⚠️");
    expect(markup).toContain("🔧");
    expectNoLeak(markup);
  });

  it("a link home that reloads the whole app (a plain <a>: the router is not mounted here), big enough to tap", () => {
    const home = links(markup).filter((l) => l.href === "/");
    expect(home).toHaveLength(1);
    expect(home[0]?.text).toBe(AR["errpage.home"]);
  });

  it("brings its own tiny stylesheet: system colours, light and dark, logical properties, a 44px tap target — no theme token, no hex", () => {
    const css = /<style[^>]*>([\s\S]*?)<\/style>/.exec(markup)?.[1] ?? "";
    expect(css).toContain("color-scheme");
    expect(css).toMatch(/light dark/);
    expect(css).toMatch(/\bCanvas\b/);
    expect(css).toMatch(/\bCanvasText\b/);
    expect(css).toMatch(/min-height:\s*2\.75rem/);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
    expect(css).not.toMatch(/\b(?:margin|padding)-(?:left|right)\b|\b(?:left|right)\s*:/);
    expect(css).not.toMatch(/var\(--/);
    // React writes the text of a <style> escaped: a quote or an angle bracket would break the rule
    expect(css).not.toMatch(/&(?:quot|amp|lt|gt|#x27);/);
  });

  describe("the retry button", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    /** The component has no hooks (the router does not exist up here), so it can be called and its tree read. */
    function findAll(node: ReactNode, test: (el: ReactElement<Record<string, unknown>>) => boolean, out: ReactElement<Record<string, unknown>>[] = []) {
      if (Array.isArray(node)) {
        for (const child of node) findAll(child as ReactNode, test, out);
      } else if (isValidElement(node)) {
        const el = node as ReactElement<Record<string, unknown>>;
        if (test(el)) out.push(el);
        findAll(el.props["children"] as ReactNode, test, out);
      }
      return out;
    }

    it("reloads the page: reset() would only draw the same failed render again", () => {
      const reload = vi.fn();
      vi.stubGlobal("window", { location: { reload } });
      const tree = (GlobalError as unknown as (p: unknown) => ReactElement)(props());
      const buttons = findAll(tree, (el) => el.type === "button");
      expect(buttons).toHaveLength(1);
      expect(buttons[0]?.props["type"]).toBe("button");
      (buttons[0]?.props["onClick"] as () => void)();
      expect(reload).toHaveBeenCalledTimes(1);
    });
  });
});

describe("no page throws a domain error itself (Next hides its message in production: the visitor gets «Application error»)", () => {
  const APP = path.resolve(__dirname, "../src/app");

  function pages(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) pages(full, out);
      else if (name === "page.tsx") out.push(full);
    }
    return out;
  }

  it("a page that cannot find something, or finds it but it is not the visitor's, calls notFound()", () => {
    const found = pages(APP);
    expect(found.length).toBeGreaterThan(25); // the sweep looks at the pages (not vacuous)
    const offenders = found.filter((file) =>
      /\bthrow\s+new\s+(?:NotFoundError|ForbiddenError|UnauthorizedError|ValidationError)\b/.test(readFileSync(file, "utf8")),
    );
    expect(offenders.map((f) => path.relative(APP, f))).toEqual([]);
  });

  it("and the four screens exist where Next looks for them", () => {
    for (const file of ["not-found.tsx", "global-error.tsx", "(app)/not-found.tsx", "(app)/error.tsx"]) {
      expect(statSync(path.join(APP, file)).isFile(), file).toBe(true);
    }
  });
});
