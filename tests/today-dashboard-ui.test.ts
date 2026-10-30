import "./ui-render";
import { createElement, type FunctionComponent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import { beforeAll, describe, expect, it, vi } from "vitest";
import config from "../tailwind.config";
import { PALETTE_COLOUR, PHYSICAL_UTILITY, classTokens, textOf } from "./ui-render";
import { stripComments } from "./themes-decor-helpers";

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

import { TodayDashboard } from "@/components/today/today-dashboard";
import { AR } from "@/lib/i18n/dict";
import { I18nProvider } from "@/lib/i18n";
import { getServerT } from "@/lib/i18n/server";
import { weekProgress, type TodayDashboard as Dash } from "@/lib/today";

/**
 * The smart cards of «اليوم»: what each number says, who gets which card, and the motion rules (CSS only,
 * behind motion-safe, no picture behind a number). The numbers themselves are proved in
 * tests/db/today-dashboard.test.ts with real rows.
 */

const { t } = getServerT();
const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const html = (element: ReactElement): string => renderToStaticMarkup(createElement(Translations, { initial: "ar" }, element));

const MINE = { open: 9, overdue: 3, dueToday: 2, doneWeek: 6, weekTotal: 8, percent: 75 };
const TEAM = { doneWeek: 21, dueToday: 4, peopleLate: 2 };
const dash = (over: Partial<Dash> = {}): Dash => ({ mine: MINE, unreadChat: 5, team: null, ...over });
const render = (data: Dash | null) => html(createElement(TodayDashboard, { data }));

describe("weekProgress: finished of (finished + still due this week)", () => {
  it("is a whole percent, and null for a week with no work", () => {
    expect(weekProgress(1, 3)).toEqual({ total: 4, percent: 25 });
    expect(weekProgress(2, 1)).toEqual({ total: 3, percent: 67 });
    expect(weekProgress(5, 0)).toEqual({ total: 5, percent: 100 });
    expect(weekProgress(0, 4)).toEqual({ total: 4, percent: 0 });
    expect(weekProgress(0, 0)).toEqual({ total: 0, percent: null });
  });
});

describe("the cards say what each number means", () => {
  const markup = render(dash());
  const text = textOf(markup);

  it("every number is followed by its label in Arabic", () => {
    expect(text).toMatch(/3\s+مهام متأخرة/);
    expect(text).toMatch(/2\s+مستحقة اليوم/);
    expect(text).toMatch(/9\s+مهامي المفتوحة/);
    expect(text).toMatch(/5\s+رسائل بانتظارك/);
    expect(markup).toContain(t("today.dash.week_of", { done: "6", total: "8" }));
    expect(text).toContain("75٪");
  });

  it("the week's ring is an arc of the percent over a track, drawn by the browser from the percent alone", () => {
    expect(markup).toContain('pathLength="100"');
    expect(markup).toMatch(/stroke-dasharray="100"/);
    expect(markup).toMatch(/stroke-dashoffset="25"/);
    expect(markup.match(/<circle\b/g)).toHaveLength(2);
  });

  it("links each card to the page that has the same numbers", () => {
    const hrefs = [...markup.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
    expect(hrefs).toEqual(["/my-work?tab=overdue", "/my-work?tab=today", "/my-work?tab=mine", "/chat"]);
  });

  it("draws only what is late in the danger colour, and nothing in it when nothing is late", () => {
    expect(markup).toMatch(/text-danger[^"]*"[^>]*>3</);
    const calm = render(dash({ mine: { ...MINE, overdue: 0 }, unreadChat: 0 }));
    expect(calm).not.toContain("text-danger");
    expect(calm).not.toContain("text-info");
  });

  it("a week with no work shows an empty ring and says so, instead of 0 of 0", () => {
    const empty = render(dash({ mine: { ...MINE, doneWeek: 0, weekTotal: 0, percent: null } }));
    expect(empty).toContain(t("today.dash.week_none"));
    expect(empty).not.toContain("pathLength");
    expect(empty.match(/<circle\b/g)).toHaveLength(1);
    expect(empty).not.toContain("من 0");
  });

  it("a week with nothing finished yet draws the track only", () => {
    const zero = render(dash({ mine: { ...MINE, doneWeek: 0, weekTotal: 4, percent: 0 } }));
    expect(zero.match(/<circle\b/g)).toHaveLength(1);
    expect(textOf(zero)).toContain("0٪");
  });
});

describe("who gets which card", () => {
  it("draws nothing for nobody: a guest and a person with no space get no section at all", () => {
    expect(render(null)).toBe("");
  });

  it("without the work numbers only the chat card is left", () => {
    const markup = render(dash({ mine: null }));
    expect(textOf(markup)).toMatch(/5\s+رسائل بانتظارك/);
    expect(markup).not.toContain(t("today.dash.overdue"));
    expect(markup).not.toContain("<circle");
  });

  it("«الفريق هالأسبوع» appears only when the service gave it, as counts with their labels and no link, name or title", () => {
    expect(render(dash())).not.toContain(t("today.dash.team"));
    const markup = render(dash({ team: TEAM }));
    expect(markup).toContain(t("today.dash.team"));
    expect(markup).toContain(t("today.dash.team_scope"));
    const text = textOf(markup);
    expect(text).toMatch(/21\s+مهام خلصت/);
    expect(text).toMatch(/4\s+مستحقة اليوم/);
    expect(text).toMatch(/2\s+أشخاص عندهم مهام متأخرة/);
    // the team strip is not a link to anything: three links beyond the personal cards would be a leak path
    expect([...markup.matchAll(/href="/g)]).toHaveLength(4);
  });
});

describe("the motion: CSS only, behind motion-safe, never a picture behind a number", () => {
  const markup = render(dash({ team: TEAM }));
  const tokens = classTokens(markup);

  it("every animation class is behind motion-safe (reduced motion gets the final picture, still readable)", () => {
    const animated = tokens.filter((c) => /animate-/.test(c));
    expect(animated.length).toBeGreaterThan(0);
    for (const c of animated) expect(c.startsWith("motion-safe:"), c).toBe(true);
    expect(animated).toEqual(expect.arrayContaining(["motion-safe:animate-rise", "motion-safe:animate-ring-fill"]));
  });

  it("the numbers are text in the markup, not drawn by the animation", () => {
    for (const n of ["3", "2", "9", "5", "21", "4"]) expect(textOf(markup)).toContain(n);
    expect(markup).not.toMatch(/<(img|canvas|video)\b/);
    expect(markup).not.toMatch(/background-image|url\(/);
  });

  it("uses theme tokens and logical CSS only, nothing wider than a phone, no hex and no inline colour", () => {
    expect(tokens.filter((c) => PALETTE_COLOUR.test(c))).toEqual([]);
    expect(tokens.filter((c) => PHYSICAL_UTILITY.test(c.split(":").pop() as string))).toEqual([]);
    expect(tokens.filter((c) => /^(?:min-|max-)?w-\[\d{3,}px\]$/.test(c))).toEqual([]);
    expect(markup).not.toMatch(/style="[^"]*(?:#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\()/);
    expect(markup).not.toMatch(/(?:fill|stroke)="#/);
  });

  it("the ring's colours are tokens (stroke-border, stroke-accent), and the page has no decoration in it", () => {
    expect(tokens).toEqual(expect.arrayContaining(["stroke-border", "stroke-accent"]));
    expect(markup).not.toMatch(/zk-decor|zk-hero-photo|data-art-slot/);
  });

  it("says everything in Arabic: no English word, no dictionary key", () => {
    const visible = [...markup.matchAll(/>([^<>]+)</g)].map((m) => m[1] as string);
    for (const v of visible) {
      expect(v, v).not.toMatch(/[A-Za-z]{2,}/);
      expect(v, v).not.toMatch(/\b(?:today|common|mywork)\.[a-z_]+/);
    }
  });

  describe("every class is one Tailwind really generates", () => {
    let css = "";
    beforeAll(async () => {
      const result = await postcss([tailwindcss({ ...config, content: [{ raw: tokens.join(" "), extension: "html" }] })]).process("@tailwind utilities;", { from: undefined });
      css = result.css;
    });
    const escapeSelector = (token: string) => token.replace(/[^a-zA-Z0-9_-]/g, (c) => (c === "," ? "\\2c " : `\\${c}`));
    const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    it("every class has a rule, and the two keyframes exist", () => {
      const missing = tokens.filter((c) => !new RegExp(`\\.${escapeRegExp(escapeSelector(c))}(?![\\w\\\\-])`).test(css));
      expect(missing).toEqual([]);
      expect(css).toMatch(/@keyframes rise/);
      expect(css).toMatch(/@keyframes ring-fill\s*\{\s*from\s*\{\s*stroke-dashoffset:\s*100/);
      expect(css).toMatch(/@media \(prefers-reduced-motion: no-preference\)/);
    });
  });
});

describe("the source", () => {
  const ROOT = path.resolve(__dirname, "..");
  const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

  it("the page asks the service and the component, and decides nothing itself", () => {
    const page = stripComments(read("src/app/(app)/page.tsx"));
    expect(page).toContain("getTodayDashboard(");
    expect(page).toContain("<TodayDashboard");
    expect(page).not.toMatch(/db\.|from "@\/server\/db"/);
    expect(page.indexOf("<FirstStepsCard")).toBeLessThan(page.indexOf("<TodayDashboard"));
    expect(page.indexOf("<TodayDashboard")).toBeLessThan(page.indexOf("<TodayTasksCard"));
  });

  it("the component has no script, no state and no dependency of its own", () => {
    const code = stripComments(read("src/components/today/today-dashboard.tsx"));
    expect(code).not.toMatch(/"use client"|useState|useEffect|requestAnimationFrame|setInterval|framer-motion/);
    const imports = [...code.matchAll(/from "([^"]+)"/g)].map((m) => m[1] as string);
    expect(imports.filter((i) => !i.startsWith("@/") && i !== "next/link")).toEqual([]);
  });

  it("the service reads the chat count through the badge's own function, and never a raw org-wide count", () => {
    const code = stripComments(read("src/server/services/today-dashboard.ts"));
    expect(code).toContain("unreadTotal(");
    expect(code).toContain("loadWorkScope(");
    expect(code).toContain("taskVisibleWhere(");
    expect(code).toContain("isExternal");
    expect(code).not.toMatch(/\$queryRaw|chatMessage\./);
  });

  it("every word of the cards exists in the dictionary", () => {
    for (const m of read("src/components/today/today-dashboard.tsx").matchAll(/t\("(today\.dash\.[\w]+)"/g)) expect(AR[m[1] as string], m[1]).toBeTruthy();
  });
});
