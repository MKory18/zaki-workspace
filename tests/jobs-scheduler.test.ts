import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// the scheduler's module graph loads the DB client at import; these tests only use its pure parts
vi.mock("@/server/db", () => ({ db: {} }));

import { JOBS_INTERVAL_MS, JOBS_LOCK_KEY, schedulerAllowed, startJobRunner, stopJobRunnerForTests } from "@/server/jobs/scheduler";
import { PURGE_LOCK_KEY } from "@/server/realtime/hub";

const ROOT = path.resolve(__dirname, "..");
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;

afterEach(() => {
  stopJobRunnerForTests();
  vi.restoreAllMocks();
});

describe("the in-app job runner starts only where it should", () => {
  it("never during `next build`, never in a test, otherwise yes", () => {
    expect(schedulerAllowed(env({ NEXT_PHASE: "phase-production-build" }))).toBe(false);
    expect(schedulerAllowed(env({ NODE_ENV: "test" }))).toBe(false);
    expect(schedulerAllowed(env({ VITEST: "true" }))).toBe(false);
    expect(schedulerAllowed(env({ NODE_ENV: "production" }))).toBe(true);
    expect(schedulerAllowed(env({}))).toBe(true);
  });

  it("`startJobRunner` does nothing here (this process is a test): no timer is ever set", () => {
    const spy = vi.spyOn(globalThis, "setInterval");
    expect(startJobRunner()).toBe(false);
    expect(spy).not.toHaveBeenCalled();
    expect(globalThis.__zkJobsTimer).toBeUndefined();
  });

  it("its lock is its own, and it ticks every 30 seconds", () => {
    expect(JOBS_LOCK_KEY).not.toBe(PURGE_LOCK_KEY);
    expect(JOBS_INTERVAL_MS).toBe(30_000);
  });

  it("instrumentation.ts starts it for the Node runtime only, and Next is told to run that hook", () => {
    const hook = read("src/instrumentation.ts");
    expect(hook).toMatch(/NEXT_RUNTIME !== "nodejs"\) return/);
    expect(hook).toContain('import("./server/jobs/scheduler")');
    expect(hook).toContain("startJobRunner()");
    // a failure of the runner must not take the boot down
    expect(hook).toContain("boot.jobs_failed");
    expect(read("next.config.mjs")).toMatch(/instrumentationHook:\s*true/);
  });

  it("the scheduler takes a PostgreSQL advisory lock on a connection of its own, and a job that throws never stops the loop", () => {
    const src = read("src/server/jobs/scheduler.ts");
    expect(src).toContain("pg_try_advisory_lock");
    expect(src).toContain("new Client(");
    expect(src).toMatch(/\.on\("error"/);
    const run = read("src/server/jobs/run.ts");
    expect(run).toMatch(/catch \(err\)[\s\S]*log\.error\("jobs\.failed"/);
  });

  it("the reminder claim is one UPDATE ... WHERE status = PENDING ... RETURNING, and the next occurrence is written in the same transaction", () => {
    const src = read("src/server/jobs/reminders.ts");
    expect(src).toMatch(/UPDATE "Reminder" SET "status" = 'FIRED'/);
    expect(src).toMatch(/"status" = 'PENDING'::"ReminderStatus" AND "dueAt" <= /);
    expect(src).toContain("RETURNING");
    const claim = src.indexOf("UPDATE \"Reminder\"");
    const rearm = src.indexOf('status: "PENDING", dueAt: next');
    const end = src.indexOf("return \"fired\"");
    expect(claim).toBeGreaterThan(0);
    expect(rearm).toBeGreaterThan(claim);
    expect(rearm).toBeLessThan(end);
  });
});
