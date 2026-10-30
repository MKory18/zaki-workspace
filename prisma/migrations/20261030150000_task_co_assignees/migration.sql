-- «المهمة لأكثر من شخص»: the people beside `Task.assigneeId`, who stays the first one named.
-- Additive only: a new pairing table (like `TaskLabel`), nothing existing is touched, and a task that
-- already has an assignee needs no backfill — the extra names are the ones chosen from now on.

CREATE TABLE "TaskCoAssignee" (
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskCoAssignee_pkey" PRIMARY KEY ("taskId","userId")
);

CREATE INDEX "TaskCoAssignee_userId_idx" ON "TaskCoAssignee"("userId");

ALTER TABLE "TaskCoAssignee" ADD CONSTRAINT "TaskCoAssignee_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TaskCoAssignee" ADD CONSTRAINT "TaskCoAssignee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
