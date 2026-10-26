import { z } from "zod";
import { db } from "@/server/db";
import { ForbiddenError, NotFoundError } from "@/server/auth";
import type { Actor } from "@/server/policy/actor";
import { spacesOf } from "@/server/services/current-space";
import { mayOverview } from "@/server/services/spaces-overview";

/**
 * «انقل لمساحة» (the plan, 2026-10-25: each space is like a separate site). The ideas, library files, goals,
 * routines, customers and opportunities from before spaces had their own carry no space, so they are read in
 * «الشركة». The OWNER and the ADMINs see them all in one list (on «كل المساحات») and move them, one or many at a
 * time, into a space they can open. Only things that have no space yet are moved here: a space's own things stay
 * where they are.
 *
 * A library file moves with all its versions; a customer takes its opportunities that have no space with it.
 */

export const UNPLACED_KINDS = ["idea", "file", "goal", "routine", "customer", "opportunity"] as const;
export type UnplacedKind = (typeof UNPLACED_KINDS)[number];

export interface UnplacedRow {
  kind: UnplacedKind;
  id: string;
  title: string;
  createdAt: string;
}

export const moveSchema = z.object({
  kind: z.enum(UNPLACED_KINDS),
  ids: z.array(z.string().min(1)).min(1).max(200),
  spaceId: z.string().min(1),
});

function assertManager(actor: Actor): void {
  if (!mayOverview(actor)) throw new ForbiddenError("spaces.move.denied");
}

const TAKE = 200;

/** Everything of the company that has no space yet, newest first in each kind. */
export async function listUnplaced(actor: Actor): Promise<UnplacedRow[]> {
  assertManager(actor);
  const orgId = actor.orgId;
  const none = { orgId, workspaceId: null } as const;
  const newest = { createdAt: "desc" as const };
  const [ideas, files, goals, routines, customers, opportunities] = await Promise.all([
    db.idea.findMany({ where: none, orderBy: newest, take: TAKE, select: { id: true, title: true, createdAt: true } }),
    db.storedFile.findMany({
      where: { ...none, purpose: "LIBRARY", isLatest: true, deletedAt: null },
      orderBy: newest,
      take: TAKE,
      select: { id: true, name: true, createdAt: true },
    }),
    db.goal.findMany({ where: none, orderBy: newest, take: TAKE, select: { id: true, title: true, createdAt: true } }),
    db.routine.findMany({ where: none, orderBy: newest, take: TAKE, select: { id: true, title: true, createdAt: true } }),
    db.customer.findMany({ where: none, orderBy: newest, take: TAKE, select: { id: true, name: true, createdAt: true } }),
    db.opportunity.findMany({ where: none, orderBy: newest, take: TAKE, select: { id: true, title: true, createdAt: true } }),
  ]);
  const row = (kind: UnplacedKind, id: string, title: string, at: Date): UnplacedRow => ({ kind, id, title, createdAt: at.toISOString() });
  return [
    ...ideas.map((r) => row("idea", r.id, r.title, r.createdAt)),
    ...files.map((r) => row("file", r.id, r.name, r.createdAt)),
    ...goals.map((r) => row("goal", r.id, r.title, r.createdAt)),
    ...routines.map((r) => row("routine", r.id, r.title, r.createdAt)),
    ...customers.map((r) => row("customer", r.id, r.name, r.createdAt)),
    ...opportunities.map((r) => row("opportunity", r.id, r.title, r.createdAt)),
  ];
}

/** Moves the chosen things that have no space yet into a space the person can open; returns how many moved. */
export async function moveToSpace(actor: Actor, input: z.infer<typeof moveSchema>): Promise<{ moved: number }> {
  assertManager(actor);
  const target = (await spacesOf(actor)).find((s) => s.id === input.spaceId);
  if (!target) throw new NotFoundError("workspace.not_found");
  const where = { orgId: actor.orgId, workspaceId: null, id: { in: input.ids } };
  const data = { workspaceId: target.id };

  const moved = await db.$transaction(async (tx) => {
    switch (input.kind) {
      case "idea":
        return (await tx.idea.updateMany({ where, data })).count;
      case "goal":
        return (await tx.goal.updateMany({ where, data })).count;
      case "routine":
        return (await tx.routine.updateMany({ where, data })).count;
      case "opportunity":
        return (await tx.opportunity.updateMany({ where, data })).count;
      case "customer": {
        const count = (await tx.customer.updateMany({ where, data })).count;
        // its opportunities that have no space go with it
        await tx.opportunity.updateMany({ where: { orgId: actor.orgId, workspaceId: null, customerId: { in: input.ids } }, data });
        return count;
      }
      case "file": {
        // a file is its family: every version moves together
        const heads = await tx.storedFile.findMany({ where: { ...where, purpose: "LIBRARY" }, select: { familyId: true } });
        const families = [...new Set(heads.map((h) => h.familyId))];
        if (!families.length) return 0;
        await tx.storedFile.updateMany({ where: { orgId: actor.orgId, workspaceId: null, familyId: { in: families } }, data });
        return heads.length;
      }
    }
  });
  return { moved };
}
