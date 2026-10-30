import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { log } from "@/server/log";
import { AUTO_STOP_MS, AUTO_STOP_SECONDS } from "@/lib/time-tracking";

/**
 * THE TIMER JOB: a timer left running more than 12 hours is closed ONCE, at `startedAt + 12h`, and marked `autoStopped`
 * so the person sees it on their task page and can correct it (the audit row keeps what it was).
 *
 * Exactly once, however many processes or overlapping runs there are: a due row is CLAIMED by
 * `UPDATE ... WHERE stoppedAt IS NULL AND startedAt < now - 12h RETURNING ...` inside one transaction, and the audit row
 * is written in that same transaction. A second run that reaches the same row waits for the first to commit, re-reads
 * it, finds it already closed and claims nothing, so a closed timer always has exactly one `time.entry_auto_stopped`
 * row. A person who pressed «وقّف» in the same instant closes it with the same rule (`closeTimer`) and a conditional
 * update, so one of the two wins and the other changes nothing.
 *
 *  - a company that switched «حساب الوقت» off: its timers are not even selected; they wait and are due when it is back;
 *  - the entry is closed at `startedAt + 12h`, never at the moment the job happened to run: a runner that was down for a
 *    night does not turn 12 hours into 20.
 */

const BATCH = 200;
/** A few batches per run, so a long outage drains over a run or two without one run holding the lock for minutes. */
const ROUNDS = 5;

export interface TimeEntriesRun {
  stopped: number;
}

async function stopOne(id: string, now: Date): Promise<boolean> {
  const limit = new Date(now.getTime() - AUTO_STOP_MS);
  return db.$transaction(async (tx) => {
    const claimed = await tx.$queryRaw<{ id: string; orgId: string; workspaceId: string; userId: string; taskId: string | null; startedAt: Date; stoppedAt: Date }[]>(Prisma.sql`
      UPDATE "TimeEntry"
      SET "stoppedAt" = "startedAt" + interval '12 hours', "seconds" = ${AUTO_STOP_SECONDS}, "autoStopped" = true, "updatedAt" = ${now}
      WHERE "id" = ${id} AND "stoppedAt" IS NULL AND "startedAt" < ${limit}
      RETURNING "id", "orgId", "workspaceId", "userId", "taskId", "startedAt", "stoppedAt"`);
    const row = claimed[0];
    if (!row) return false;
    await tx.auditLog.create({
      data: {
        action: "time.entry_auto_stopped",
        actorId: null,
        orgId: row.orgId,
        target: row.id,
        workspaceId: row.workspaceId,
        meta: { by: "job", userId: row.userId, taskId: row.taskId, startedAt: row.startedAt.toISOString(), stoppedAt: row.stoppedAt.toISOString(), seconds: AUTO_STOP_SECONDS },
      },
    });
    return true;
  });
}

export async function autoStopTimers(now: Date): Promise<TimeEntriesRun> {
  const run: TimeEntriesRun = { stopped: 0 };
  const limit = new Date(now.getTime() - AUTO_STOP_MS);
  for (let round = 0; round < ROUNDS; round++) {
    // the company's switch is read here: a company that turned the feature off keeps its running rows untouched
    const due = await db.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT t."id" FROM "TimeEntry" t JOIN "Organization" o ON o."id" = t."orgId"
      WHERE t."stoppedAt" IS NULL AND t."startedAt" < ${limit}
        AND COALESCE(o."settings" #>> '{features,timeTracking}', 'true') <> 'false'
      ORDER BY t."startedAt" ASC, t."id" ASC LIMIT ${BATCH}`);
    let moved = 0;
    for (const { id } of due) {
      try {
        if (await stopOne(id, now)) {
          run.stopped++;
          moved++;
        }
      } catch (err) {
        // one broken row is logged and left; it never stops the others or the loop
        log.error("jobs.time_entry_failed", { id, message: err instanceof Error ? err.message : String(err) });
      }
    }
    if (due.length < BATCH || moved === 0) break;
  }
  return run;
}
