import { resolveTimeZone, zonedDayStart } from "@/lib/zoned-time";
import { db } from "@/server/db";

/**
 * The start of the COMPANY's today — `Organization.timezone`, never the server's clock and never the
 * browser's.
 *
 * «متأخرة» is one question and it must have one answer: My Work, the Today page and the reports all
 * measure a task against this line (see `services/today.ts`, `services/analytics.ts` and
 * `services/my-work.ts`). A list asked for an "overdue" filter has to measure against the same line,
 * or the same task is late on one screen and not on the next depending on what hour it is.
 */
export async function orgDayStart(orgId: string, now: Date = new Date()): Promise<Date> {
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { timezone: true } });
  return zonedDayStart(now, resolveTimeZone(org?.timezone));
}
