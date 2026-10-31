/**
 * «الأداء والتطوير» — THE PURE PART: the limits, the reporting-line arithmetic (loops, depth, subtrees) and the small
 * rules the pages and the tests read directly. No React, no Next, no database.
 *
 * A reporting line is `OrganizationMember.managerId` (the manager's USER id; null = nobody above, the owner is the
 * implicit top). Everything here takes it as a `managerOf` map: person → their manager.
 */

/** Skill levels: 0 لا يعرف · 1 مبتدئ · 2 يعتمد عليه بمساعدة · 3 مستقل · 4 يعلّم غيره. */
export const SKILL_LEVELS = [0, 1, 2, 3, 4] as const;
export type SkillLevel = (typeof SKILL_LEVELS)[number];

export const SKILL_LIMITS = {
  name: 60,
  category: 40,
  description: 300,
  note: 300,
  /** Every skill of the company, archived ones included (nothing is ever deleted, so this is what bounds the table). */
  maxSkills: 100,
} as const;

/** The longest chain: nobody has more than this many supervisors above them. */
export const MAX_LINE_DEPTH = 6;

export type ManagerMap = ReadonlyMap<string, string | null>;

/** manager → the people who answer to them. */
export function childrenOf(managerOf: ManagerMap): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [person, manager] of managerOf) {
    if (!manager) continue;
    const list = out.get(manager) ?? [];
    list.push(person);
    out.set(manager, list);
  }
  return out;
}

/** Everybody below `rootId`, direct and indirect, `rootId` itself excluded. A loop in old data cannot hang the walk. */
export function subtreeOf(managerOf: ManagerMap, rootId: string): string[] {
  const children = childrenOf(managerOf);
  const seen = new Set<string>([rootId]);
  const out: string[] = [];
  const queue = [rootId];
  while (queue.length) {
    const next = queue.shift() as string;
    for (const child of children.get(next) ?? []) {
      if (seen.has(child)) continue;
      seen.add(child);
      out.push(child);
      queue.push(child);
    }
  }
  return out;
}

/** How many supervisors are above this person (0: nobody). Stops at a loop. */
export function depthAbove(managerOf: ManagerMap, personId: string): number {
  const seen = new Set<string>([personId]);
  let depth = 0;
  let cursor = managerOf.get(personId) ?? null;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    depth += 1;
    cursor = managerOf.get(cursor) ?? null;
  }
  return depth;
}

/** How many levels are below this person (0: nobody answers to them). */
export function heightBelow(managerOf: ManagerMap, personId: string): number {
  const children = childrenOf(managerOf);
  let height = 0;
  let level = [personId];
  const seen = new Set<string>([personId]);
  while (level.length) {
    const next: string[] = [];
    for (const id of level) {
      for (const child of children.get(id) ?? []) {
        if (seen.has(child)) continue;
        seen.add(child);
        next.push(child);
      }
    }
    if (next.length) height += 1;
    level = next;
  }
  return height;
}

/**
 * Would putting `subjectId` under `newManagerId` make a chain longer than `max` supervisors? The subject's own people
 * move with them, so the deepest person below the subject counts too.
 */
export function exceedsLineDepth(managerOf: ManagerMap, subjectId: string, newManagerId: string, max: number = MAX_LINE_DEPTH): boolean {
  // the subject leaves their old place: what is above the new manager is judged without them
  const without = new Map(managerOf);
  without.set(subjectId, null);
  return depthAbove(without, newManagerId) + 1 + heightBelow(without, subjectId) > max;
}

/** The gap between the supervisor's level and the person's own estimate (positive: the supervisor rates higher). null when either is missing. */
export function skillGap(manual: number | null | undefined, self: number | null | undefined): number | null {
  if (typeof manual !== "number" || typeof self !== "number") return null;
  return manual - self;
}

/** A level the screens and routes accept. */
export function isSkillLevel(value: unknown): value is SkillLevel {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 4;
}
