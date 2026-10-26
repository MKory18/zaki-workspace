/**
 * THE FIVE PLACES — the one map of the navigation.
 *
 * The owner's plan for Phase 2: five places and no more — اليوم · الدردشة · الشغل · المكتبة · الإدارة; and a sixth
 * by his own ask (2026-10-26), after them: نتفرّج سوا.
 * A place has tabs, and every tab is a page that already existed: nothing was removed and no old
 * address broke, the pages were only grouped (LEGACY_ROUTES lists them, and a test proves each one
 * is still a page and still has a home here).
 *
 * The bottom bar (phone), the side menu (computer), the tab strip, the command palette and the
 * guide's tours all read this one module. It is PURE on purpose — no React, no Next, no server
 * imports — so the (app) layout computes the person's map on the server (`buildNav`), the shell
 * draws it in the browser, and the tests read it directly.
 *
 * ⚠️ The map is discoverability only. A tab that is not offered is still refused by the server on
 *    its own (every page and route decides from the session), and a tab that IS offered may still
 *    show the page's own "not for you" notice.
 * 🔧 When a page's rule changes, change its tab's `requires` here too: tests/nav-places.test.ts
 *    pins who sees what, rank by rank.
 *
 * ⚠️ One rule runs the other way and has no exception: a page or route whose tab is NOT offered to
 *    an external partner (a guest) must refuse a guest and hand them no company data, even though a
 *    guest never sees the link. A page may be open to MORE people than its tab (the reports page
 *    serves everybody who is not a guest, its tab is offered from LEAD up), never to a guest unless
 *    the tab includes guests.
 * 🔧 `canOpenTab` / `offeredToGuests` below are that rule in one place: the pages that refuse guests
 *    ask `offeredToGuests`, so flipping a tab here flips them with it, and
 *    tests/db/guest-internal-pages.test.ts renders every tab's page as every rank to prove it.
 */

/** The ranks, as the policy names them (src/server/policy/rank.ts keeps the order; a test compares). */
export const NAV_ROLES = ["OWNER", "ADMIN", "LEAD", "MEMBER", "GUEST"] as const;
export type NavRole = (typeof NAV_ROLES)[number];

/**
 * Who the map is drawn for: the rank held in the ACTIVE organization and the EFFECTIVE capabilities
 * (the rank's defaults plus and minus what the owner switched). The layout passes `actor.role` and
 * `[...actor.caps]`.
 */
export interface NavSubject {
  role: NavRole;
  caps: readonly string[];
}

export type PlaceKey = "today" | "chat" | "work" | "library" | "admin" | "watch";

export type TabKey =
  | "my-work"
  | "projects"
  | "list"
  | "calendar"
  | "goals"
  | "ideas"
  | "production"
  | "departments"
  | "tickets"
  | "campaigns"
  | "crm"
  | "files"
  | "team"
  | "reports"
  | "automation"
  | "telegram"
  | "settings"
  | "archive";

/** An icon by NAME: the shell maps it to a drawing (src/components/shell/nav-icons.tsx). Data only, so it crosses from server to browser. */
export type NavIconKey = "today" | "chat" | "work" | "library" | "admin" | "team" | "reports" | "automation" | "telegram" | "settings" | "watch";

/**
 * Who may see a place or a tab:
 *   "everyone"            every signed-in person, an external partner (guest) included
 *   "staff"               everybody but a guest
 *   { capability }        holds that switch (a guest never does, whatever was stored)
 *   { rankAtLeast }       that rank or above
 *   { anyOf }             one of these
 */
export type Requirement =
  | "everyone"
  | "staff"
  | { readonly capability: string }
  | { readonly rankAtLeast: NavRole }
  | { readonly anyOf: readonly Requirement[] };

export interface TabDef {
  readonly key: TabKey;
  readonly href: string;
  readonly labelKey: string;
  readonly requires: Requirement;
  /** The icon the place wears when this is its only tab (only the admin place takes its tab's name). */
  readonly icon?: NavIconKey;
  /** Other addresses that are this tab's pages (a board is part of a project, an old URL that moved). */
  readonly also?: readonly string[];
}

export interface PlaceDef {
  readonly key: PlaceKey;
  /** Where the place opens. Left out: on its first tab the person may use. */
  readonly href?: string;
  readonly labelKey: string;
  readonly icon: NavIconKey;
  readonly requires: Requirement;
  /** Empty: a place that is one page. Otherwise the place is shown only while one of them is. */
  readonly tabs: readonly TabDef[];
  /** Addresses that belong to the place without being one of its tabs (a task: from a list, a board, a notification). */
  readonly owns?: readonly string[];
  /** With exactly one tab left, the place is called by that tab (a plain member sees «الفريق», not «الإدارة»). */
  readonly singleTabTakesLabel?: boolean;
}

export const PLACES: readonly PlaceDef[] = [
  { key: "today", href: "/", labelKey: "nav.place.today", icon: "today", requires: "everyone", tabs: [] },
  // Chat is available to guests; server-side topic policy limits what they can read.
  { key: "chat", href: "/chat", labelKey: "nav.place.chat", icon: "chat", requires: "everyone", tabs: [] },
  {
    key: "work",
    href: "/my-work",
    labelKey: "nav.place.work",
    icon: "work",
    requires: "everyone",
    owns: ["/tasks"],
    tabs: [
      { key: "my-work", href: "/my-work", labelKey: "nav.tab.myWork", requires: "everyone" },
      { key: "projects", href: "/projects", labelKey: "nav.projects", requires: "everyone", also: ["/boards"] },
      { key: "list", href: "/list", labelKey: "nav.listView", requires: "everyone" },
      { key: "calendar", href: "/calendar", labelKey: "nav.calendar", requires: "everyone" },
      // The company's own goals and ideas (titles, descriptions, who wrote them): not shared with an external
      // partner. The pages and /api/goals, /api/ideas refuse a guest too (docs/PHASE0-AUDIT.md R10).
      { key: "goals", href: "/goals", labelKey: "nav.goals", requires: { capability: "goals.view" } },
      // temporary: becomes a chat topic in Phase 3
      { key: "ideas", href: "/ideas", labelKey: "nav.ideas", requires: { capability: "ideas.view" } },
      { key: "production", href: "/production", labelKey: "nav.production", requires: { capability: "production.view" } },
      { key: "departments", href: "/departments", labelKey: "nav.departments", requires: "staff" },
      // a department's tickets and campaigns, each a page of its own (the owner's ask, 2026-10-25)
      { key: "tickets", href: "/tickets", labelKey: "nav.tickets", requires: "staff" },
      { key: "campaigns", href: "/campaigns", labelKey: "nav.campaigns", requires: "staff" },
      { key: "crm", href: "/crm", labelKey: "nav.crm", requires: { capability: "crm.view" } },
    ],
  },
  {
    key: "library",
    href: "/files",
    labelKey: "nav.place.library",
    icon: "library",
    requires: "staff",
    // /documents was an empty "coming soon" page: it is a redirect to /files now
    tabs: [{ key: "files", href: "/files", labelKey: "nav.files", requires: "staff", also: ["/documents"] }],
  },
  {
    key: "admin",
    labelKey: "nav.place.admin",
    icon: "admin",
    requires: "everyone",
    singleTabTakesLabel: true,
    tabs: [
      // /teams stays a working address, but it is the same people as /members: one tab, not two.
      // /members is the directory for whoever holds `directory.view` AND the people manager for whoever holds
      // `users.manage` (even with the directory switched off), so either switch opens the tab.
      {
        key: "team",
        href: "/members",
        labelKey: "nav.tab.team",
        icon: "team",
        requires: { anyOf: [{ capability: "directory.view" }, { capability: "users.manage" }] },
        also: ["/teams", "/u"],
      },
      { key: "reports", href: "/analytics", labelKey: "nav.analytics", icon: "reports", requires: { capability: "reports.view" } },
      { key: "automation", href: "/automation", labelKey: "nav.tab.automation", icon: "automation", requires: { capability: "integrations.manage" } },
      { key: "telegram", href: "/telegram", labelKey: "nav.telegram", icon: "telegram", requires: { capability: "integrations.manage" } },
      {
        key: "settings",
        href: "/settings",
        labelKey: "nav.settings",
        icon: "settings",
        requires: { anyOf: [{ capability: "users.manage" }, { rankAtLeast: "OWNER" }] },
      },
      { key: "archive", href: "/archive", labelKey: "nav.archive", requires: { capability: "archive.view" } },
    ],
  },
  // «نتفرّج سوا» (the owner's ask, 2026-10-26: «الشغل، تحتها المكتبة، الإدارة، ثم نتفرّج سوا»): a place of its own,
  // one page, after «الإدارة». People of a space watch one link together; the sessions are the team's own talk,
  // so not an external partner's (the page and /api/watch refuse a guest too: `placeOfferedToGuests`).
  { key: "watch", href: "/watch", labelKey: "nav.place.watch", icon: "watch", requires: "staff", tabs: [] },
];

/**
 * Every address the app had before Phase 2. Each one is still a page (`src/app/(app)/<route>/page.tsx`,
 * `[id]` being the dynamic folder) and each one still has a place or, for the profile, deliberately none.
 */
export const LEGACY_ROUTES = [
  "/",
  "/chat",
  "/my-work",
  "/projects",
  "/projects/[id]",
  "/projects/[id]/timeline",
  "/boards/[id]",
  "/tasks/[id]",
  "/list",
  "/calendar",
  "/goals",
  "/ideas",
  "/production",
  "/departments",
  "/teams",
  "/members",
  "/files",
  "/documents",
  "/crm",
  "/analytics",
  "/automation",
  "/telegram",
  "/settings",
  "/profile",
  "/u/[id]",
] as const;

// ───────────────────────────────────────── who sees what ─────────────────────────────────────────

const RANK_ORDER: Readonly<Record<NavRole, number>> = { OWNER: 50, ADMIN: 40, LEAD: 30, MEMBER: 20, GUEST: 10 };

const knownRole = (role: string): role is NavRole => Object.prototype.hasOwnProperty.call(RANK_ORDER, role);

/** `role` is `min` or above. An unknown rank is below everything. */
export function rankAtLeast(role: NavRole, min: NavRole): boolean {
  return knownRole(role) && RANK_ORDER[role] >= RANK_ORDER[min];
}

function meets(req: Requirement, subject: NavSubject): boolean {
  // an unknown rank is treated like an outsider: shown what everybody may see, nothing more
  const outsider = !knownRole(subject.role) || subject.role === "GUEST";
  if (req === "everyone") return true;
  if (req === "staff") return !outsider;
  if ("anyOf" in req) return req.anyOf.some((r) => meets(r, subject));
  if ("capability" in req) return !outsider && subject.caps.includes(req.capability);
  return rankAtLeast(subject.role, req.rankAtLeast);
}

/** A tab, with the place it lives in (undefined: no such tab). */
function findTab(tabKey: TabKey): { place: PlaceDef; tab: TabDef } | undefined {
  for (const place of PLACES) {
    const tab = place.tabs.find((candidate) => candidate.key === tabKey);
    if (tab) return { place, tab };
  }
  return undefined;
}

/**
 * Is this tab OFFERED to this person: the place AND the tab accept them, which is exactly when
 * `buildNav` draws it. An unknown tab is offered to nobody. It decides discoverability only (see the
 * header): a page may still serve more people than its tab is offered to, but never a guest unless
 * the tab includes guests (`offeredToGuests`).
 */
export function canOpenTab(subject: NavSubject, tabKey: TabKey): boolean {
  const found = findTab(tabKey);
  return found !== undefined && meets(found.place.requires, subject) && meets(found.tab.requires, subject);
}

/**
 * Is this tab offered to an external partner (a guest)? Whatever a guest row says, a guest holds no
 * capability, so this depends on the map alone. A page that refuses guests asks this instead of
 * repeating the rule: `if (actor.isExternal && !offeredToGuests("goals")) return <GuestNotice />`.
 */
export function offeredToGuests(tabKey: TabKey): boolean {
  return canOpenTab({ role: "GUEST", caps: [] }, tabKey);
}

/** Is this place (of any kind: one page, or tabs) on this person's map? Exactly when `buildNav` draws it. */
export function canOpenPlace(subject: NavSubject, placeKey: PlaceKey): boolean {
  return buildNav(subject).places.some((drawn) => drawn.key === placeKey);
}

/** `offeredToGuests` for a place that is one page (Today, the chat, «نتفرّج سوا»). */
export function placeOfferedToGuests(placeKey: PlaceKey): boolean {
  return canOpenPlace({ role: "GUEST", caps: [] }, placeKey);
}

// ───────────────────────────────────────── the person's map ─────────────────────────────────────────

export interface NavTab {
  key: TabKey;
  href: string;
  labelKey: string;
}

export interface NavPlace {
  key: PlaceKey;
  href: string;
  labelKey: string;
  icon: NavIconKey;
  /** The tabs this person may use, in order; empty for a place that is one page. */
  tabs: NavTab[];
}

export interface NavModel {
  places: NavPlace[];
}

/**
 * The places this person may use, each with the tabs they may use — plain data (names, addresses and
 * dictionary keys), so the server computes it and hands it to the browser as it is.
 */
export function buildNav(subject: NavSubject): NavModel {
  const places: NavPlace[] = [];
  for (const def of PLACES) {
    if (!meets(def.requires, subject)) continue;
    const allowed = def.tabs.filter((tab) => meets(tab.requires, subject));
    if (def.tabs.length > 0 && allowed.length === 0) continue;

    const first = allowed[0];
    const only = def.singleTabTakesLabel && allowed.length === 1 ? first : undefined;
    const href = !first || allowed.some((tab) => tab.href === def.href) ? (def.href ?? "/") : first.href;

    places.push({
      key: def.key,
      href,
      labelKey: only?.labelKey ?? def.labelKey,
      icon: only?.icon ?? def.icon,
      tabs: allowed.map(({ key, href: tabHref, labelKey }) => ({ key, href: tabHref, labelKey })),
    });
  }
  return { places };
}

// ───────────────────────────────────────── where an address lives ─────────────────────────────────────────

interface Prefix {
  path: string;
  place: PlaceKey;
  tab: TabKey | null;
}

/** Every address prefix the map knows, with the place (and the tab) it belongs to. */
const PREFIXES: readonly Prefix[] = PLACES.flatMap((def) => [
  ...(def.tabs.length === 0 && def.href ? [{ path: def.href, place: def.key, tab: null }] : []),
  ...(def.owns ?? []).map((path) => ({ path, place: def.key, tab: null })),
  ...def.tabs.flatMap((tab) => [tab.href, ...(tab.also ?? [])].map((path) => ({ path, place: def.key, tab: tab.key }))),
]);

/** The path of an address, without its query, its hash or a trailing slash; null when it is no path of this site. */
function pathOf(pathname: string): string | null {
  if (typeof pathname !== "string" || !pathname.startsWith("/") || pathname.startsWith("//")) return null;
  const bare = (pathname.split(/[?#]/, 1)[0] ?? "").replace(/\/+$/, "");
  return bare === "" ? "/" : bare;
}

/** `prefix` is the address itself or a folder above it ("/projects" covers "/projects/x", not "/projectsx"). */
function covers(prefix: string, path: string): boolean {
  if (prefix === "/") return path === "/";
  return path === prefix || path.startsWith(`${prefix}/`);
}

const NOWHERE = { place: null, tab: null } as const;

/**
 * The place and the tab an address belongs to: the longest known prefix wins, so "/projects/x/timeline"
 * is the projects tab of «الشغل», "/tasks/x" is «الشغل» without a tab, "/u/x" is «الفريق», and the
 * profile, the guide and the onboarding belong to no place.
 */
export function locate(pathname: string): { place: PlaceKey | null; tab: TabKey | null } {
  const path = pathOf(pathname);
  if (!path) return { ...NOWHERE };
  let best: Prefix | null = null;
  for (const prefix of PREFIXES) {
    if (!covers(prefix.path, path)) continue;
    if (!best || prefix.path.length > best.path.length) best = prefix;
  }
  return best ? { place: best.place, tab: best.tab } : { ...NOWHERE };
}

/** The place an address belongs to (null: none). */
export function placeOfPath(pathname: string): PlaceKey | null {
  return locate(pathname).place;
}

/** The tab an address belongs to (null: none, or a page of the place that is no tab). */
export function tabOfPath(pathname: string): TabKey | null {
  return locate(pathname).tab;
}
