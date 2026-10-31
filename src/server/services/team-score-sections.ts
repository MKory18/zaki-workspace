import { db } from "@/server/db";
import { isFeatureOn } from "@/server/services/features";
import type { BoardSection, SectionContext } from "@/server/services/owner-board-sections";

/**
 * «السكور» — THE EXTENSION POINT.  ⚠️ Marked on purpose, like `BOARD_SECTIONS`: this is where another feature adds a number that is
 * SHOWN BESIDE a person's score (never part of the composite: a count is not a judgement of quality). It uses the very same shape
 * as the owner board's sections (`BoardSection`), so a section written for one can be registered in the other.
 *
 * Today: «الوقت المسجّل» (the time tracked on tasks, from `TimeEntry`), a plain number of minutes.
 *
 * 🔧 «الإجابة على الاستيقاظ اليومي» (the daily check-in answered rate) is NOT read here: its table is not on `main` yet, and a
 *    section that reads a table that may not exist would stop the deploy. When it lands, its own PR adds a file next to this one that
 *    exports a `BoardSection` and registers it in `SCORE_SECTIONS` below; nothing else of the score changes.
 *    A section must read ONLY the people it is asked for (`ctx.userIds`) and ONLY what falls in `ctx.window`, and return numbers.
 */

/** «الوقت المسجّل»: minutes logged on tasks in the window (finished entries that started in it), exactly the time report's own rule. */
export const timeTrackedSection: BoardSection = {
  id: "time",
  columns: [{ key: "time.minutes", labelKey: "teamdev.score.time", formulaKey: "teamdev.score.time_formula", kind: "minutes" }],
  async load(ctx: SectionContext) {
    const out = new Map<string, Record<string, number | string | null>>();
    // off, the feature has no entries to show: no column at all (a switched-off feature is as if it never existed)
    if (!(await isFeatureOn(ctx.orgId, "timeTracking"))) return out;
    if (ctx.userIds.length === 0) return out;
    const rows = await db.timeEntry.groupBy({
      by: ["userId"],
      _sum: { seconds: true },
      where: { orgId: ctx.orgId, userId: { in: [...ctx.userIds] }, stoppedAt: { not: null }, startedAt: { gte: ctx.window.start, lt: ctx.window.end } },
    });
    for (const id of ctx.userIds) out.set(id, { "time.minutes": 0 });
    for (const r of rows) out.set(r.userId, { "time.minutes": Math.round((r._sum.seconds ?? 0) / 60) });
    return out;
  },
};

/** ⚠️ Registered here: the time tracked. 🔧 A later PR registers the check-ins' answered rate. */
export const SCORE_SECTIONS: readonly BoardSection[] = [timeTrackedSection];
