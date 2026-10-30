-- «حساب وقت الشغل»: the time people log on tasks.
-- Additive only: one new enum, one new table, its indexes and one foreign key (to the task, ON DELETE SET NULL: an entry
-- outlives its task and keeps `taskTitle`). Durations are whole SECONDS (INTEGER), never floats.

-- CreateEnum
CREATE TYPE "TimeEntrySource" AS ENUM ('TIMER', 'MANUAL');

-- CreateTable
CREATE TABLE "TimeEntry" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "taskId" TEXT,
    "taskTitle" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "stoppedAt" TIMESTAMP(3),
    "seconds" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT NOT NULL DEFAULT '',
    "source" "TimeEntrySource" NOT NULL,
    "autoStopped" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimeEntry_pkey" PRIMARY KEY ("id"),
    -- an entry is never longer than a day, and a finished one never ends before it began
    CONSTRAINT "TimeEntry_seconds_range" CHECK ("seconds" >= 0 AND "seconds" <= 86400),
    CONSTRAINT "TimeEntry_stopped_after_start" CHECK ("stoppedAt" IS NULL OR "stoppedAt" >= "startedAt")
);

-- CreateIndex
CREATE INDEX "TimeEntry_userId_startedAt_idx" ON "TimeEntry"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "TimeEntry_taskId_idx" ON "TimeEntry"("taskId");

-- CreateIndex
CREATE INDEX "TimeEntry_workspaceId_startedAt_idx" ON "TimeEntry"("workspaceId", "startedAt");

-- A person has at most ONE running timer. Hand-written: Prisma cannot express a partial index (the table is new and
-- empty, so a unique index on it is safe).
CREATE UNIQUE INDEX "TimeEntry_one_running_per_user" ON "TimeEntry"("userId") WHERE "stoppedAt" IS NULL;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
