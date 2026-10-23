import "./ui-render";
import { createElement, type FunctionComponent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { PHYSICAL_UTILITY, PALETTE_COLOUR, classTokens, textOf } from "./ui-render";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

import { GuideCard } from "@/components/guide/guide-card";
import { NewWheel } from "@/components/shell/new-wheel";
import { NightDaySwitch } from "@/components/theme/night-day-switch";
import { I18nProvider } from "@/lib/i18n";
import { AR } from "@/lib/i18n/dict";
import { DEFAULT_THEME, THEMES } from "@/lib/themes/registry";
import { PALETTES } from "@/lib/themes/palettes";
import { ToastProvider } from "@/components/ui/toast";

/**
 * THE ADOPTED LOOK («نجمة وطريق») — the parts that were added for it, held to the same rules as the
 * rest of the shell: Arabic names on every control, theme tokens only, logical CSS only, a thumb-sized
 * target, and no behaviour of the mockup left as decoration (the wheel navigates, the switch switches,
 * the guide card starts the real tour).
 */

const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const Toasts = ToastProvider as unknown as FunctionComponent<{ children?: ReactNode }>;

function html(element: ReactElement): string {
  return renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(Toasts, null, element)));
}

const ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

describe("«ليل / نهار»: the two-theme switch of the top bar", () => {
  const markup = html(createElement(NightDaySwitch));

  it("is a group of two named buttons, «ليل» and «نهار»", () => {
    expect(markup).toContain(`aria-label="${AR["shell.theme.aria"]}"`);
    expect(textOf(markup)).toBe(`${AR["shell.theme.night"]} ${AR["shell.theme.day"]}`);
  });

  it("never lies about the look: on a third theme neither side is pressed", () => {
    // the provider's default is the night, so the night side is the pressed one here
    expect(markup).toMatch(new RegExp(`aria-pressed="true"[^>]*>${AR["shell.theme.night"]}<`));
    expect(markup).toMatch(new RegExp(`aria-pressed="false"[^>]*>${AR["shell.theme.day"]}<`));
  });

  it("is a shortcut over the four themes, not a replacement: both halves are real themes", () => {
    expect(THEMES["islamic-epic"].dark).toBe(true);
    expect(THEMES.day.dark).toBe(false);
    expect(DEFAULT_THEME).toBe("islamic-epic");
  });
});

describe("«جديد»: the gold wheel", () => {
  const markup = html(createElement(NewWheel));

  it("is a named, gold, thumb-sized button that says it opens a dialog", () => {
    const button = /<button\b[^>]*aria-haspopup="dialog"[^>]*>/.exec(markup)?.[0] ?? "";
    expect(button).toContain('type="button"');
    expect(button).toMatch(/\bh-\[42px\]/);
    expect(button).toMatch(/\bbg-accent-2\b/);
    expect(textOf(markup)).toContain(AR["shell.new"]);
    // nothing of the wheel is on the page until it is opened
    expect(markup).not.toContain('role="dialog"');
  });

  it("carries six actions, each with an Arabic word from the dictionary", () => {
    const keys = ["task", "project", "doc", "msg", "team", "member"] as const;
    const source = read("src/components/shell/new-wheel.tsx");
    for (const key of keys) expect(source, key).toContain(`key: "${key}"`);
    for (const key of keys) expect(AR[`shell.new.${key}`], key).toMatch(/[؀-ۿ]/);
  });

  it("keeps the mockup's geometry in the stylesheet, not in a physical utility (the app is RTL)", () => {
    const tokens = classTokens(markup);
    expect(tokens.filter((c) => PALETTE_COLOUR.test(c))).toEqual([]);
    expect(tokens.filter((c) => PHYSICAL_UTILITY.test(c.split(":").pop() as string))).toEqual([]);
    const css = read("src/app/globals.css");
    expect(css).toContain(".zk-wheel-ring");
    expect(css).toContain(".zk-wheel-item");
    expect(css).toMatch(/repeating-conic-gradient/);
  });
});

describe("«دليل زاكي»: the card under the route", () => {
  const markup = html(createElement(GuideCard, { userId: "u1" }));

  it("welcomes the person and offers the tour and «بعدين»", () => {
    expect(markup).toContain(AR["guide.card.title"] as string);
    expect(markup).toContain(AR["guide.card.body"] as string);
    expect(textOf(markup)).toContain(AR["guide.card.start"] as string);
    expect(textOf(markup)).toContain(AR["guide.card.later"] as string);
    expect(markup).toContain(`aria-label="${AR["guide.card.aria"]}"`);
  });

  it("draws the gold arch beside the words (a decoration, never behind them)", () => {
    const arch = /<div aria-hidden="true" class="([^"]*)"/.exec(markup)?.[1] ?? "";
    expect(arch).toContain("zk-arch");
    expect(markup.indexOf("zk-arch")).toBeLessThan(markup.indexOf(AR["guide.card.title"] as string));
  });

  it("loads the real tour only when «يلا» is pressed (no driver.js in the first paint)", () => {
    const source = read("src/components/guide/guide-card.tsx");
    expect(source).toContain('await import("./tour-runner")');
    expect(source).toContain("startTour(");
    expect(markup).not.toContain("driver");
  });
});

describe("the adopted look's shapes live in globals.css, filled with theme tokens", () => {
  const css = read("src/app/globals.css");

  for (const name of [".zk-star", ".zk-pattern", ".zk-side-rule", ".zk-gta", ".zk-hero-art", ".zk-hero-shade", ".zk-arch", ".zk-route", ".zk-check", ".zk-quick", ".zk-orn", ".zk-seg-on"]) {
    it(`${name} is defined`, () => {
      expect(css).toContain(name);
    });
  }

  it("every colour in those rules is a token (rgb(var(--…))), never a hex value", () => {
    const start = css.indexOf("The adopted look");
    const block = css.slice(start);
    expect(block.length).toBeGreaterThan(2000);
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(block).toMatch(/rgb\(var\(--accent-2\)/);
  });

  it("the mission photograph ships with the build (one file, shared by both themes)", () => {
    expect(existsSync(path.join(ROOT, "public/brand/hero/amman-sunset.jpg"))).toBe(true);
    expect(css).toContain('/brand/hero/amman-sunset.jpg');
  });
});
