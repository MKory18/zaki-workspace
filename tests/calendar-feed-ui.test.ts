import { createElement } from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/calendar",
}));

import { middleware } from "../src/middleware";
import { CalendarFeedView, type CalendarFeedViewProps } from "@/components/calendar-feed/calendar-feed-card";
import { AR } from "@/lib/i18n/dict";
import { FEATURES, FEATURE_DEFAULTS } from "@/lib/features";
import { PALETTE_COLOUR, PHYSICAL_UTILITY, classTokens, render, textOf } from "./ui-render";

const ROOT = path.resolve(__dirname, "..");
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

const noop = () => {};
const base: CalendarFeedViewProps = {
  tokens: [],
  timeZone: "Asia/Damascus",
  createdUrl: null,
  label: "",
  onLabel: noop,
  onCreate: noop,
  onCopy: noop,
  onDismiss: noop,
  onRevoke: noop,
};
const view = (over: Partial<CalendarFeedViewProps> = {}) => render(createElement(CalendarFeedView, { ...base, ...over }));

/** The two rules every screen keeps: theme tokens only, and logical (RTL-safe) directions. */
function expectClean(markup: string) {
  const tokens = classTokens(markup);
  expect(tokens.filter((t) => PALETTE_COLOUR.test(t)), "palette colours").toEqual([]);
  expect(tokens.filter((t) => PHYSICAL_UTILITY.test(t)), "physical directions").toEqual([]);
  expect(markup).not.toMatch(/style="[^"]*#[0-9a-f]{3,8}/i);
}

describe("«اشتراك التقويم»: the card", () => {
  it("offers «أنشئ رابط الاشتراك» and says there are no links yet", () => {
    const markup = view();
    const text = textOf(markup);
    expect(text).toContain("اشتراك التقويم");
    expect(text).toContain("أنشئ رابط الاشتراك");
    expect(text).toContain(AR["calfeed.empty"]);
    expect(markup).not.toContain("data-calendar-feed-once");
    expectClean(markup);
  });

  it("shows the new link ONCE, readable left-to-right, with a copy button and the three ways to add it", () => {
    const url = "https://workspace.zakiai.io/api/calendar/feed/AbCdEf0123456789AbCdEf0123456789AbCdEf01234.ics";
    const markup = view({ createdUrl: url });
    expect(markup).toContain("data-calendar-feed-once");
    expect(markup).toContain(`value="${url}"`);
    expect(markup).toContain('dir="ltr"');
    const text = textOf(markup);
    expect(text).toContain("انسخ الرابط");
    for (const key of ["calfeed.step_google", "calfeed.step_apple", "calfeed.step_outlook"]) expect(text, key).toContain(AR[key]);
    // while the link is on show the create form is not (one link at a time)
    expect(markup).not.toContain("أنشئ رابط الاشتراك");
    expectClean(markup);
  });

  it("without a new link the address is nowhere on the card (only its dates and label are listed)", () => {
    const markup = view({ tokens: [{ id: "t1", label: "جوالي", createdAt: "2031-03-10T06:00:00.000Z", lastUsedAt: null, stale: false }] });
    expect(markup).not.toContain("/api/calendar/feed/");
    expect(markup).not.toContain("data-calendar-feed-once");
  });

  it("lists each link with its label, created, last used and «إلغاء»", () => {
    const markup = view({
      tokens: [
        { id: "t1", label: "جوالي", createdAt: "2031-03-10T06:00:00.000Z", lastUsedAt: "2031-03-12T06:00:00.000Z", stale: false },
        { id: "t2", label: "اللابتوب", createdAt: "2031-03-11T06:00:00.000Z", lastUsedAt: null, stale: false },
      ],
    });
    const text = textOf(markup);
    expect(text).toContain("جوالي");
    expect(text).toContain("اللابتوب");
    expect(text).toContain("أُنشئ");
    expect(text).toContain("آخر استخدام");
    expect(text).toContain(AR["calfeed.never_used"]);
    expect(markup.match(/data-feed-token=/g)).toHaveLength(2);
    expect(markup).toContain('aria-label="إلغاء الرابط جوالي"');
    expect(markup.match(/>إلغاء</g)).toHaveLength(2);
    expectClean(markup);
  });

  it("marks a link that stopped working (sessions ended) with its reason", () => {
    const markup = view({ tokens: [{ id: "t1", label: "قديم", createdAt: "2031-03-10T06:00:00.000Z", lastUsedAt: null, stale: true }] });
    expect(textOf(markup)).toContain(AR["calfeed.stale"]);
    expect(markup).toContain(`title="${AR["calfeed.stale_hint"]}"`);
  });

  it("draws the risk with its fix together: ⚠️ and 🔧", () => {
    const text = textOf(view());
    expect(text).toContain("⚠️ " + AR["calfeed.warn"]);
    expect(text).toContain("🔧 " + AR["calfeed.fix"]);
  });

  it("shows an error as an alert and a result as a status, through the dictionary", () => {
    expect(view({ error: "calfeed.too_many" })).toContain(`role="alert"`);
    expect(textOf(view({ error: "calfeed.too_many" }))).toContain(AR["calfeed.too_many"]);
    expect(textOf(view({ note: "calfeed.revoked" }))).toContain(AR["calfeed.revoked"]);
  });
});

describe("«اشتراك التقويم»: where it sits", () => {
  it("the calendar page mounts the card for staff only, behind the company's switch", () => {
    const page = read("src/app/(app)/calendar/page.tsx");
    expect(page).toMatch(/actorFeatureOn\(actor, "calendarFeed"\)/);
    expect(page).toMatch(/!actor\.isExternal/);
    expect(page).toContain("<CalendarFeedCard");
  });

  it("is a feature with a default (on) and its two lines of Arabic in its own fragment", () => {
    expect(FEATURES).toContain("calendarFeed");
    expect(FEATURE_DEFAULTS.calendarFeed).toBe(true);
    expect(AR["features.calendarFeed.name"]).toMatch(/[؀-ۿ]/);
    expect(AR["features.calendarFeed.hint"]).toMatch(/[؀-ۿ]/);
    expect(read("src/lib/i18n/dict.ts")).toContain('./ar.calendar-feed.json');
  });

  it("every error the service can raise has its Arabic sentence", () => {
    for (const key of ["calfeed.too_many", "calfeed.guest", "calfeed.not_found", "calfeed.label_long", "calfeed.failed"]) expect(AR[key], key).toMatch(/[؀-ۿ]/);
    const service = read("src/server/services/calendar-feed.ts");
    for (const m of service.matchAll(/(?:ForbiddenError|NotFoundError)\("(calfeed\.[a-z_]+)"\)|message: "(calfeed\.[a-z_]+)"/g)) {
      expect(AR[(m[1] ?? m[2]) as string], m[0]).toBeTruthy();
    }
  });
});

describe("«اشتراك التقويم»: the door in the middleware", () => {
  const req = (p: string, init: { method?: string; headers?: Record<string, string> } = {}) =>
    new NextRequest(`http://localhost:3000${p}`, { method: init.method ?? "GET", headers: new Headers({ host: "localhost:3000", ...init.headers }) });

  it("a calendar app (no cookie, no Origin) reaches the feed route: it is not sent to the sign-in page", async () => {
    const res = await middleware(req("/api/calendar/feed/AbCdEf0123456789AbCdEf0123456789AbCdEf01234.ics"));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("is a GET-only door: a cross-site write to it is still refused by the Origin guard (it is not a machine path)", async () => {
    const res = await middleware(req("/api/calendar/feed/x.ics", { method: "POST", headers: { origin: "https://evil.example" } }));
    expect(res.status).toBe(403);
    const src = read("src/middleware.ts");
    expect(src).not.toMatch(/MACHINE_PATHS = \[[^\]]*calendar/);
  });

  it("the route declares only GET and sets no cookie", () => {
    const route = read("src/app/api/calendar/feed/[token]/route.ts");
    expect(route).toMatch(/export async function GET/);
    expect(route).not.toMatch(/export async function (POST|PUT|PATCH|DELETE)/);
    expect(route).not.toMatch(/cookies|Set-Cookie/i);
    expect(route).toContain("text/calendar; charset=utf-8");
    expect(route).toContain("private, max-age=300");
  });
});
