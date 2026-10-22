import { Client } from "pg";
import { log } from "@/server/log";
import { PURGE_LOCK_KEY } from "./hub";
import { directPgUrl } from "./listener";

/**
 * The hourly purge job: deletes RealtimeEvent rows older than 48 h.
 *
 * Runs in EVERY server process but takes a Postgres advisory lock first, so only
 * ONE process actually purges in a cycle (the others skip silently). Started from
 * `instrumentation.ts` only when NEXT_RUNTIME === "nodejs" and not during
 * `next build`.
 */

export const PURGE_INTERVAL_MS = 3600_000;
const RETENTION_MS = 48 * 3600_000;

export async function purgeRealtimeEvents(): Promise<number> {
  const url = process.env["DATABASE_URL"];
  if (!url) return 0;
  const client = new Client({ connectionString: directPgUrl(url) });
  try {
    await client.connect();
    const locked = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS locked",
      [PURGE_LOCK_KEY],
    );
    if (!locked.rows[0]?.locked) return 0;
    try {
      // FILES (Wave 3B) asks the hourly cycle to also sweep uploads that no message
      // ever claimed. Guarded: a storage failure must not stop the event purge.
      try {
        const { purgeOrphanUploads } = await import("@/server/chat/attachments");
        if (typeof purgeOrphanUploads === "function") await purgeOrphanUploads();
      } catch (err) {
        log.error("rt.purge_uploads_failed", { message: err instanceof Error ? err.message : String(err) });
      }
      // Quoted: the table was created as "RealtimeEvent" (mixed case); unquoted SQL folds to lowercase.
      const res = await client.query<{ id: string }>(
        'DELETE FROM "RealtimeEvent" WHERE "createdAt" < now() - interval \'48 hours\' RETURNING "id"::text',
      );
      if (res.rowCount) log.info("rt.purged", { count: res.rowCount });
      return res.rowCount ?? 0;
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [PURGE_LOCK_KEY]);
    }
  } catch (err) {
    log.error("rt.purge_failed", { message: err instanceof Error ? err.message : String(err) });
    return 0;
  } finally {
    await client.end().catch(() => undefined);
  }
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Test hook: run one purge cycle now, without the interval (never call from server code). */
export function runPurgeOnceForTests(): Promise<number> {
  return purgeRealtimeEvents();
}

/** Stops the interval timer (test hook; never call from server code). */
export function stopPurgeTimerForTests(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

/**
 * Starts the hourly cycle. Safe to call from every process: the advisory lock
 * makes the extra processes no-ops.
 */
export function startPurgeJob(): void {
  if (timer) return;
  // first run shortly after boot (not immediately: boot is busy), then hourly
  timer = setInterval(() => void purgeRealtimeEvents(), PURGE_INTERVAL_MS);
  timer.unref?.();
  setTimeout(() => void purgeRealtimeEvents(), 30_000).unref?.();
}

/** The retention window, exported for the docs and the route's replay window. */
export const REALTIME_RETENTION_MS = RETENTION_MS;
