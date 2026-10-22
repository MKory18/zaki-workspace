/**
 * The guided tours («فرجيني»). A pure module: it says which elements a tour visits and what it says
 * about each; the browser part (src/components/guide/tour-runner.tsx) draws it with driver.js.
 *
 * A tour finds its elements by a stable hook, the attribute data-tour on the element. The hooks are
 * a contract between the agents that render the elements and this guide (see the Phase 2 briefing):
 *   places       the navigation of places (bottom bar on a phone, side menu on a computer)
 *   tabs         the tab strip of the current place
 *   search       the search / quick-navigation button
 *   inbox        the notification bell
 *   avatar       the avatar menu
 *   theme        the theme picker (inside the avatar menu)
 *   today-tasks  the list of today's tasks on the Today page
 *   first-steps  the first-steps card
 *   quick-add    the quick-add button
 * A hook that is not on the page (a menu that is closed, a place with a single tab) is skipped, so
 * a tour never points at nothing.
 */

export const TOUR_HOOKS = [
  "places",
  "tabs",
  "search",
  "inbox",
  "avatar",
  "theme",
  "today-tasks",
  "first-steps",
  "quick-add",
] as const;
export type TourHook = (typeof TOUR_HOOKS)[number];

export const TOUR_KEYS = ["shell", "today"] as const;
export type TourKey = (typeof TOUR_KEYS)[number];

export interface TourStep {
  hook: TourHook;
  titleKey: string;
  bodyKey: string;
  /**
   * Which side of the element the popover prefers. Only top and bottom: the page is right-to-left,
   * and the library falls back to the sides on its own when there is no room (a desktop side menu
   * gets its popover on the content side).
   */
  side?: "top" | "bottom";
}

export const TOURS: Record<TourKey, readonly TourStep[]> = {
  // the app tour: the same shell on every page
  shell: [
    { hook: "places", titleKey: "guide.tour.shell.places.title", bodyKey: "guide.tour.shell.places.body", side: "top" },
    { hook: "tabs", titleKey: "guide.tour.shell.tabs.title", bodyKey: "guide.tour.shell.tabs.body", side: "bottom" },
    { hook: "search", titleKey: "guide.tour.shell.search.title", bodyKey: "guide.tour.shell.search.body", side: "bottom" },
    { hook: "inbox", titleKey: "guide.tour.shell.inbox.title", bodyKey: "guide.tour.shell.inbox.body", side: "bottom" },
    { hook: "avatar", titleKey: "guide.tour.shell.avatar.title", bodyKey: "guide.tour.shell.avatar.body", side: "bottom" },
    { hook: "theme", titleKey: "guide.tour.shell.theme.title", bodyKey: "guide.tour.shell.theme.body", side: "bottom" },
  ],
  // the Today page's own elements
  today: [
    { hook: "today-tasks", titleKey: "guide.tour.today.today-tasks.title", bodyKey: "guide.tour.today.today-tasks.body", side: "bottom" },
    { hook: "quick-add", titleKey: "guide.tour.today.quick-add.title", bodyKey: "guide.tour.today.quick-add.body", side: "bottom" },
    { hook: "first-steps", titleKey: "guide.tour.today.first-steps.title", bodyKey: "guide.tour.today.first-steps.body", side: "bottom" },
  ],
};

const ATTRIBUTE = "data-tour";

/** The CSS selector of a hook. */
export function hookSelector(hook: TourHook): string {
  return `[${ATTRIBUTE}="${hook}"]`;
}

/** The steps of a tour whose element is on the page, in the tour's order. */
export function planTour(key: TourKey, has: (hook: TourHook) => boolean): TourStep[] {
  return (TOURS[key] ?? []).filter((step) => has(step.hook));
}

/** What the tour library is given for one step: the element, and the words in Arabic. */
export interface PlannedStep<E> {
  element: E;
  popover: { title: string; description: string; side?: "top" | "bottom"; align: "center" };
}

/**
 * The steps ready for the library: each present element paired with its title and body, each
 * missing element left out. `find` is asked once per step, in order (the browser passes a lookup of
 * the visible element; a test passes a fake).
 */
export function resolveTourSteps<E>(
  key: TourKey,
  t: (key: string) => string,
  find: (hook: TourHook) => E | null,
): PlannedStep<E>[] {
  const out: PlannedStep<E>[] = [];
  for (const step of TOURS[key] ?? []) {
    const element = find(step.hook);
    if (element === null || element === undefined) continue;
    out.push({
      element,
      // centred, not "start": start means the physical left edge in the library, which is the wrong end in Arabic
      popover: { title: t(step.titleKey), description: t(step.bodyKey), ...(step.side ? { side: step.side } : {}), align: "center" },
    });
  }
  return out;
}
