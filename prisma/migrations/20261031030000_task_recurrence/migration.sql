-- «مهمة متكررة»: one repeating series (TaskRecurrence) and the nullable link every occurrence carries (Task.recurrenceId).
-- Additive only: one new enum, one new table with its indexes and foreign keys, one nullable indexed column.
-- Deleting the template task (or its project, board or space) deletes the series; the occurrences stay and lose the link.

-- CreateEnum
CREATE TYPE "RecurrenceMode" AS ENUM ('ON_COMPLETE', 'SCHEDULE');

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "recurrenceId" TEXT;

-- CreateTable
CREATE TABLE "TaskRecurrence" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "templateTaskId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "rule" JSONB NOT NULL,
    "mode" "RecurrenceMode" NOT NULL,
    "nextDueAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "stoppedReason" TEXT,
    "lastCreatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskRecurrence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TaskRecurrence_templateTaskId_key" ON "TaskRecurrence"("templateTaskId");

-- CreateIndex
CREATE INDEX "TaskRecurrence_active_mode_nextDueAt_idx" ON "TaskRecurrence"("active", "mode", "nextDueAt");

-- CreateIndex
CREATE INDEX "TaskRecurrence_orgId_idx" ON "TaskRecurrence"("orgId");

-- CreateIndex
CREATE INDEX "Task_recurrenceId_idx" ON "Task"("recurrenceId");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_recurrenceId_fkey" FOREIGN KEY ("recurrenceId") REFERENCES "TaskRecurrence"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskRecurrence" ADD CONSTRAINT "TaskRecurrence_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskRecurrence" ADD CONSTRAINT "TaskRecurrence_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskRecurrence" ADD CONSTRAINT "TaskRecurrence_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskRecurrence" ADD CONSTRAINT "TaskRecurrence_templateTaskId_fkey" FOREIGN KEY ("templateTaskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

