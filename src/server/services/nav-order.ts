import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { ForbiddenError } from "@/server/auth";
import type { Actor } from "@/server/policy/actor";
import { featuresOff } from "@/lib/features";
import { buildNav, type NavModel, type NavSubject } from "@/lib/nav/places";
import { firstUnseen, readNavOrder, type NavOrder } from "@/lib/nav/order";
import type { SpaceLayout } from "@/lib/cards/shared";
import { currentSpace } from "./current-space";

/**
 * «ترتيبي» — the person's own order of the menu, kept on the account (`User.navOrder`, one nullable JSON column).
 *
 * It is PERSONAL: every function takes the person's id from the session and nothing else, so nobody reads or writes
 * another person's order. It is only an ORDER: it is applied over the map the person may see (`applyNavOrder`), so a
 * saved order never reveals or hides anything, and a save that names something the person may not see is refused.
 */

/**
 * Who the map is drawn for — the one place that turns an actor into a `NavSubject`, shared by the (app) layout and by
 * the save below, so «what the person may see» is decided the same way in both.
 */
export function navSubjectOf(actor: Pick<Actor, "role" | "caps" | "isExternal">, orgSettings: unknown, space: { manager: boolean; layout?: SpaceLayout } | null): NavSubject {
  return {
    role: actor.role,
    caps: [...actor.caps],
    off: featuresOff(orgSettings),
    spaceManager: !actor.isExternal && space?.manager === true,
    // a space of «لوحات» or «تصنيع» offers «اللوحات» and «الإدارة» only (the pure map decides: src/lib/nav/places.ts)
    ...(space?.layout ? { spaceLayout: space.layout } : {}),
  };
}

/** The map this person is offered right now (read from the database, the cookie decides nothing). */
export async function visibleNavFor(actor: Actor): Promise<NavModel> {
  const org = await db.organization.findUnique({ where: { id: actor.orgId }, select: { settings: true } });
  const space = await currentSpace(actor);
  return buildNav(navSubjectOf(actor, org?.settings, space));
}

/** The person's saved order (null: the code's order). A stored value that is damaged reads as «none», never as an error. */
export async function getNavOrder(userId: string): Promise<NavOrder | null> {
  const row = await db.user.findUnique({ where: { id: userId }, select: { navOrder: true } });
  return readNavOrder(row?.navOrder);
}

/**
 * Saves the person's order (replacing the one before). `order` is already schema-valid (known keys, no duplicates); it
 * must also name only places and tabs this person may see — otherwise 403 `navorder.not_visible` and nothing is written.
 * An order that says nothing is the same as none: the column is cleared.
 */
export async function saveNavOrder(actor: Actor, order: NavOrder): Promise<NavOrder | null> {
  const nav = await visibleNavFor(actor);
  if (firstUnseen(order, nav) !== null) throw new ForbiddenError("navorder.not_visible");
  const clean = readNavOrder(order);
  await db.user.update({ where: { id: actor.userId }, data: { navOrder: clean ? { places: clean.places, tabs: clean.tabs } : Prisma.DbNull } });
  return clean;
}

/** «رجّع الترتيب الأصلي»: back to the code's order. */
export async function resetNavOrder(userId: string): Promise<void> {
  await db.user.update({ where: { id: userId }, data: { navOrder: Prisma.DbNull } });
}
