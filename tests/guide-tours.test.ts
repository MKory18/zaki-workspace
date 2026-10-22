import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AR } from "@/lib/i18n/dict";
import { TOUR_HOOKS, TOUR_KEYS, TOURS, hookSelector, planTour, resolveTourSteps, type TourHook } from "@/lib/guide/tours";

/** The hooks the briefing promises (the contract between the shell, the home page, the guide and the themes). */
const BRIEFED = ["places", "tabs", "search", "inbox", "avatar", "theme", "today-tasks", "first-steps", "quick-add"];

describe("the tour hooks", () => {
  it("are exactly the stable hooks of the briefing", () => {
    expect([...TOUR_HOOKS].sort()).toEqual([...BRIEFED].sort());
  });

  it("make an attribute selector on data-tour", () => {
    expect(hookSelector("places")).toBe('[data-tour="places"]');
    expect(hookSelector("first-steps")).toBe('[data-tour="first-steps"]');
  });
});

describe("the tours", () => {
  it("there is an app tour and a today tour", () => {
    expect([...TOUR_KEYS].sort()).toEqual(["shell", "today"]);
    expect(Object.keys(TOURS).sort()).toEqual(["shell", "today"]);
  });

  it("every step points at a known hook, and no tour visits the same element twice", () => {
    for (const key of TOUR_KEYS) {
      const hooks = TOURS[key].map((s) => s.hook);
      for (const hook of hooks) expect(TOUR_HOOKS, `${key}: ${hook}`).toContain(hook);
      expect(new Set(hooks).size, key).toBe(hooks.length);
    }
  });

  it("the app tour walks the shell: places, tabs, search, the bell, the avatar menu and the theme picker", () => {
    expect(TOURS.shell.map((s) => s.hook)).toEqual(["places", "tabs", "search", "inbox", "avatar", "theme"]);
  });

  it("the today tour walks today's own elements: tasks, quick add and the first-steps card", () => {
    expect(TOURS.today.map((s) => s.hook)).toEqual(["today-tasks", "quick-add", "first-steps"]);
  });

  it("every step has a title and a body in the dictionary, in Arabic, short", () => {
    for (const key of TOUR_KEYS) {
      for (const step of TOURS[key]) {
        for (const k of [step.titleKey, step.bodyKey]) {
          const text = AR[k];
          expect(text, `${key}/${step.hook}: ${k}`).toBeTruthy();
          expect(text, k).toMatch(/[؀-ۿ]/);
        }
        expect((AR[step.titleKey] ?? "").length).toBeLessThanOrEqual(30);
        expect((AR[step.bodyKey] ?? "").length).toBeLessThanOrEqual(150);
      }
    }
  });

  it("speaks to the person in the second person and never promises what is not built (no assistant, no calls)", () => {
    for (const key of TOUR_KEYS) {
      for (const step of TOURS[key]) {
        const body = AR[step.bodyKey] ?? "";
        for (const word of ["المساعد", "مكالمة", "المكالمات"]) expect(body).not.toContain(word);
      }
    }
  });

  it("the buttons of the tour are labelled in Arabic: التالي، السابق، تمام، إغلاق", () => {
    expect(AR["guide.tour.next"]).toBe("التالي");
    expect(AR["guide.tour.prev"]).toBe("السابق");
    expect(AR["guide.tour.done"]).toBe("تمام");
    expect(AR["guide.tour.close"]).toBe("إغلاق");
    // driver.js fills {{current}} and {{total}} itself
    expect(AR["guide.tour.progress"]).toContain("{{current}}");
    expect(AR["guide.tour.progress"]).toContain("{{total}}");
  });
});

describe("planTour: a step whose element is not on the page is skipped", () => {
  const present = (...hooks: TourHook[]) => (hook: TourHook) => hooks.includes(hook);

  it("keeps every step when every element is there, in order", () => {
    expect(planTour("shell", () => true).map((s) => s.hook)).toEqual(["places", "tabs", "search", "inbox", "avatar", "theme"]);
  });

  it("drops the steps whose element is missing and keeps the rest in order", () => {
    // the theme picker lives inside the closed avatar menu; a single-tab place has no tab strip
    expect(planTour("shell", present("places", "search", "inbox", "avatar")).map((s) => s.hook)).toEqual(["places", "search", "inbox", "avatar"]);
    expect(planTour("today", present("first-steps")).map((s) => s.hook)).toEqual(["first-steps"]);
  });

  it("returns nothing when nothing is on the page (the caller says so instead of starting an empty tour)", () => {
    expect(planTour("shell", () => false)).toEqual([]);
    expect(planTour("today", () => false)).toEqual([]);
  });

  it("an unknown tour plans nothing", () => {
    expect(planTour("nope" as never, () => true)).toEqual([]);
  });
});

describe("resolveTourSteps: the steps the tour library is given", () => {
  const t = (key: string) => AR[key] ?? key;

  it("pairs each present element with its Arabic title and body, and skips the missing ones", () => {
    const places = { name: "places-element" };
    const search = { name: "search-element" };
    const found: Partial<Record<TourHook, object>> = { places, search };
    const steps = resolveTourSteps("shell", t, (hook) => found[hook] ?? null);
    expect(steps.map((s) => s.element)).toEqual([places, search]);
    expect(steps.map((s) => s.popover.title)).toEqual([AR["guide.tour.shell.places.title"], AR["guide.tour.shell.search.title"]]);
    expect(steps.map((s) => s.popover.description)).toEqual([AR["guide.tour.shell.places.body"], AR["guide.tour.shell.search.body"]]);
    for (const s of steps) {
      expect(s.popover.title).toMatch(/[؀-ۿ]/);
      expect(s.popover.description).toMatch(/[؀-ۿ]/);
    }
  });

  it("is empty when no element is on the page", () => {
    expect(resolveTourSteps("today", t, () => null)).toEqual([]);
  });

  it("asks for each hook once, in the tour's order", () => {
    const asked: string[] = [];
    resolveTourSteps("shell", t, (hook) => {
      asked.push(hook);
      return null;
    });
    expect(asked).toEqual(["places", "tabs", "search", "inbox", "avatar", "theme"]);
  });

  it("never lets a popover sit to the physical left or right of an element (the page is right-to-left)", () => {
    const everything = () => ({});
    for (const key of TOUR_KEYS) {
      for (const s of resolveTourSteps(key, t, everything)) {
        expect(["top", "bottom", undefined]).toContain(s.popover.side);
      }
    }
  });
});

describe("the contract in the source: only known hooks are used as data-tour", () => {
  const SRC = path.resolve(__dirname, "../src");

  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.(ts|tsx)$/.test(name)) out.push(full);
    }
    return out;
  }

  it("every data-tour attribute written as a literal names a hook of the contract", () => {
    const unknown: string[] = [];
    for (const file of walk(SRC)) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/data-tour=["']([^"']+)["']/g)) {
        if (!(TOUR_HOOKS as readonly string[]).includes(m[1] as string)) unknown.push(`${path.relative(SRC, file)}: ${m[1]}`);
      }
    }
    expect(unknown, "a new hook belongs in the briefing and in src/lib/guide/tours.ts").toEqual([]);
  });
});
