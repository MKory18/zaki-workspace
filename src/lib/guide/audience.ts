/**
 * Who a piece of the guide is for. A pure module (no React, no server imports): the guide pages,
 * the help button the shell mounts, the first-steps card and the tests all read it, and it is small
 * on purpose so the shell does not carry the articles around just to know who may open which.
 *
 * Three levels, each including the one before:
 *   everyone  - every signed-in person, an external partner (guest) included
 *   staff     - the team: everybody except a guest
 *   managers  - whoever manages people (the `users.manage` switch; the owner holds every switch)
 *
 * The same word describes the article and the viewer: a guest's level is "everyone" (they may read
 * what is for everyone and nothing above), a member's is "staff", a people manager's is "managers".
 * Authorization is still decided on the server, per request: this only keeps the guide honest.
 */

export const AUDIENCES = ["everyone", "staff", "managers"] as const;
export type Audience = (typeof AUDIENCES)[number];

const LEVEL: Record<Audience, number> = { everyone: 0, staff: 1, managers: 2 };

/** May a viewer of this level read something meant for `required` and above? */
export function canRead(viewer: Audience, required: Audience): boolean {
  return LEVEL[required] <= LEVEL[viewer];
}

/** What the guide needs to know about the signed-in person (an `Actor` fits as it is). */
export interface ViewerFacts {
  isExternal: boolean;
  caps: ReadonlySet<string> | readonly string[];
}

function holds(caps: ViewerFacts["caps"], capability: string): boolean {
  if ("has" in caps) return caps.has(capability);
  return caps.includes(capability);
}

/**
 * The guide level of a person. An external partner is "everyone" whatever else their row says;
 * whoever holds `users.manage` is a manager (the switch decides, not the rank); the rest are staff.
 */
export function audienceOf(actor: ViewerFacts): Audience {
  if (actor.isExternal) return "everyone";
  return holds(actor.caps, "users.manage") ? "managers" : "staff";
}

/**
 * Who each article is for. The one table: the articles take their level from here, and the page
 * help reads it to link only to articles the viewer can open (a link must never lead to a 404).
 */
export const ARTICLE_AUDIENCE = {
  start: "everyone",
  places: "everyone",
  spaces: "everyone",
  tasks: "staff",
  projects: "everyone",
  "ideas-goals": "everyone",
  company: "staff",
  team: "managers",
  themes: "everyone",
  install: "everyone",
  privacy: "everyone",
  shortcuts: "everyone",
} as const satisfies Record<string, Audience>;

export type ArticleSlug = keyof typeof ARTICLE_AUDIENCE;
