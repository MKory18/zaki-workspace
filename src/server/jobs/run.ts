import { log } from "@/server/log";
import { fireDueReminders, type RemindersRun } from "./reminders";

/**
 * Every background job of the app, in one place: `runDueJobs(now)` runs whatever is due at `now`.
 *
 * It takes the clock as a parameter so a database test can call it directly, with no timer. It never takes a lock
 * (the scheduler does, src/server/jobs/scheduler.ts) and every job is idempotent, so two overlapping calls are safe.
 * A job that throws is logged and the next one still runs.
 */
export interface JobsRun {
  reminders: RemindersRun | null;
  /** The names of the jobs that threw. */
  failed: string[];
}

export async function runDueJobs(now: Date = new Date()): Promise<JobsRun> {
  const result: JobsRun = { reminders: null, failed: [] };
  try {
    result.reminders = await fireDueReminders(now);
  } catch (err) {
    result.failed.push("reminders");
    log.error("jobs.failed", { job: "reminders", message: err instanceof Error ? err.message : String(err) });
  }
  return result;
}
