import { Client } from "pg";
import { log } from "@/server/log";
import { directPgUrl } from "@/server/realtime/listener";
import { runDueJobs, type JobsRun } from "./run";

/**
 * THE IN-APP JOB RUNNER. Background work runs INSIDE the app process (the compose `worker` is a heartbeat placeholder):
 * `instrumentation.ts` starts this once per server process; every 30 seconds it calls `runDueJobs(now)`.
 *
 * Guard: a PostgreSQL ADVISORY LOCK (`pg_try_advisory_lock`) on a connection of its own. With two app processes only the
 * one holding the lock works that tick; the other skips silently. The lock belongs to the connection, so it is dropped
 * the moment the process dies (or the connection does) and the other process takes over on its next tick. The jobs are
 * idempotent anyway, so the lock is for economy, never for correctness.
 *
 * Never during `next build`, never in tests (`NEXT_PHASE`, `NODE_ENV=test`, `VITEST`): a test calls `runDueJobs(now)`
 * or `tickJobs(now)` itself.
 */

/** Any constant bigint, different from the purge job's (src/server/realtime/hub.ts). */
export const JOBS_LOCK_KEY = 742272;
export const JOBS_INTERVAL_MS = 30_000;
/** A tick that has not finished by now is abandoned: its connection is closed, which drops the lock. */
const TICK_TIMEOUT_MS = 5 * 60_000;

/** May the scheduler run in this process? Not while building, not in a test. */
export function schedulerAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env["NEXT_PHASE"] === "phase-production-build") return false;
  if (env["NODE_ENV"] === "test" || env["VITEST"]) return false;
  return true;
}

/**
 * One tick: take the lock, run what is due, release. Returns null when another process holds the lock (or the
 * database cannot be reached: logged), otherwise what ran.
 */
export async function tickJobs(now: Date = new Date()): Promise<JobsRun | null> {
  const url = process.env["DATABASE_URL"];
  if (!url) return null;
  const client = new Client({ connectionString: directPgUrl(url) });
  // an idle connection that drops must never be an unhandled 'error' event (that would take the whole process down)
  client.on("error", (err) => log.warn("jobs.lock_connection_error", { message: err.message }));
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await client.connect();
    const locked = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock($1) AS locked", [JOBS_LOCK_KEY]);
    if (!locked.rows[0]?.locked) return null;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("jobs tick timed out")), TICK_TIMEOUT_MS);
      timer.unref?.();
    });
    return await Promise.race([runDueJobs(now), timeout]);
  } catch (err) {
    log.error("jobs.tick_failed", { message: err instanceof Error ? err.message : String(err) });
    return null;
  } finally {
    if (timer) clearTimeout(timer);
    // closing the connection drops the session lock whether or not the explicit unlock got through
    await client.query("SELECT pg_advisory_unlock($1)", [JOBS_LOCK_KEY]).catch(() => undefined);
    await client.end().catch(() => undefined);
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __zkJobsTimer: ReturnType<typeof setInterval> | undefined;
}

/** Starts the loop (once per process, even when Next loads this module twice). A job that throws never stops it. */
export function startJobRunner(): boolean {
  if (!schedulerAllowed() || globalThis.__zkJobsTimer) return false;
  let busy = false;
  const run = () => {
    if (busy) return;
    busy = true;
    void tickJobs()
      .catch((err) => log.error("jobs.loop_failed", { message: err instanceof Error ? err.message : String(err) }))
      .finally(() => {
        busy = false;
      });
  };
  globalThis.__zkJobsTimer = setInterval(run, JOBS_INTERVAL_MS);
  globalThis.__zkJobsTimer.unref?.();
  // the first tick shortly after boot (boot is busy), not immediately
  setTimeout(run, 10_000).unref?.();
  return true;
}

/** Test hook: stop the loop (never call from server code). */
export function stopJobRunnerForTests(): void {
  if (globalThis.__zkJobsTimer) clearInterval(globalThis.__zkJobsTimer);
  globalThis.__zkJobsTimer = undefined;
}
