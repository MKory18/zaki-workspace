-- Giving a task to somebody of a higher rank is a request (the owner's rule, 2026-10-30).
-- Additive only: one enum and one new table; nothing existing is touched.

-- CreateEnum
CREATE TYPE "TaskAssignRequestStatus" AS ENUM ('PENDING', 'ACCEPTED', 'RETURNED');

-- CreateTable
CREATE TABLE "TaskAssignRequest" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "toUserId" TEXT NOT NULL,
    "status" "TaskAssignRequestStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answeredAt" TIMESTAMP(3),

    CONSTRAINT "TaskAssignRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaskAssignRequest_taskId_status_idx" ON "TaskAssignRequest"("taskId", "status");

-- CreateIndex
CREATE INDEX "TaskAssignRequest_toUserId_status_idx" ON "TaskAssignRequest"("toUserId", "status");

-- AddForeignKey
ALTER TABLE "TaskAssignRequest" ADD CONSTRAINT "TaskAssignRequest_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
