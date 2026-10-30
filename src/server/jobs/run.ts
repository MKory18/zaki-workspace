import { log } from "@/server/log";
import { fireDueReminders, type RemindersRun } from "./reminders";
import { fireDueRecurrences, type RecurrencesRun } from "./recurrence";
import { autoStopTimers, type TimeEntriesRun } from "./time-entries";
import { expireAiProposals, type AiProposalsRun } from "./ai-proposals";

/**
 * Every background job of the app, in one place: `runDueJobs(now)` runs whatever is due at `now`.
 *
 * It takes the clock as a parameter so a database test can call it directly, with no timer. It never takes a lock
 * (the scheduler does, src/server/jobs/scheduler.ts) and every job is idempotent, so two overlapping calls are safe.
 * A job that throws is logged and the next one still runs.
 */
export interface JobsRun {
  reminders: RemindersRun | null;
  /** «مهمة متكررة» (حسب الجدول): the tasks made for the series whose day has come. */
  recurrences: RecurrencesRun | null;
  /** «حساب وقت الشغل»: the timers left running more than 12 hours, closed at the 12th hour. */
  timeEntries: TimeEntriesRun | null;
  /** «مساعد المالك»: the proposals nobody decided in 48 hours, marked EXPIRED. */
  aiProposals: AiProposalsRun | null;
  /** The names of the jobs that threw. */
  failed: string[];
}

export async function runDueJobs(now: Date = new Date()): Promise<JobsRun> {
  const result: JobsRun = { reminders: null, recurrences: null, timeEntries: null, aiProposals: null, failed: [] };
  try {
    result.reminders = await fireDueReminders(now);
  } catch (err) {
    result.failed.push("reminders");
    log.error("jobs.failed", { job: "reminders", message: err instanceof Error ? err.message : String(err) });
  }
  try {
    result.recurrences = await fireDueRecurrences(now);
  } catch (err) {
    result.failed.push("recurrences");
    log.error("jobs.failed", { job: "recurrences", message: err instanceof Error ? err.message : String(err) });
  }
  try {
    result.timeEntries = await autoStopTimers(now);
  } catch (err) {
    result.failed.push("timeEntries");
    log.error("jobs.failed", { job: "timeEntries", message: err instanceof Error ? err.message : String(err) });
  }
  try {
    result.aiProposals = await expireAiProposals(now);
  } catch (err) {
    result.failed.push("aiProposals");
    log.error("jobs.failed", { job: "aiProposals", message: err instanceof Error ? err.message : String(err) });
  }
  return result;
}
