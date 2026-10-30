-- «مهمة بمكافأة» and «تثبيت» (the owner, 2026-10-30): a reward on a task, who it was awarded to, and a pin.
-- Additive only: twelve NULLABLE columns on "Task" (no default, no NOT NULL: every old row stays a plain task), two indexes
-- and range checks that every existing row passes (they are all NULL). Money is an integer in minor units (cents), never a float.
-- No foreign keys on purpose (the same as "TaskStep"): the award is history and outlives a person's row.

-- AlterTable
ALTER TABLE "Task" ADD COLUMN "rewardAmountMinor" INTEGER;
ALTER TABLE "Task" ADD COLUMN "rewardCurrency" TEXT;
ALTER TABLE "Task" ADD COLUMN "rewardNote" TEXT;
ALTER TABLE "Task" ADD COLUMN "rewardStatus" TEXT;
ALTER TABLE "Task" ADD COLUMN "rewardAwardedToId" TEXT;
ALTER TABLE "Task" ADD COLUMN "rewardAwardedAt" TIMESTAMP(3);
ALTER TABLE "Task" ADD COLUMN "rewardApprovedById" TEXT;
ALTER TABLE "Task" ADD COLUMN "rewardCancelReason" TEXT;
ALTER TABLE "Task" ADD COLUMN "rewardCancelledAt" TIMESTAMP(3);
ALTER TABLE "Task" ADD COLUMN "pinnedAt" TIMESTAMP(3);
ALTER TABLE "Task" ADD COLUMN "pinnedById" TEXT;

-- The database refuses what the code refuses: an amount above zero and under the cap, three capital letters, a known status.
ALTER TABLE "Task" ADD CONSTRAINT "Task_rewardAmountMinor_check" CHECK ("rewardAmountMinor" IS NULL OR ("rewardAmountMinor" > 0 AND "rewardAmountMinor" <= 100000000));
ALTER TABLE "Task" ADD CONSTRAINT "Task_rewardCurrency_check" CHECK ("rewardCurrency" IS NULL OR "rewardCurrency" ~ '^[A-Z]{3}$');
ALTER TABLE "Task" ADD CONSTRAINT "Task_rewardStatus_check" CHECK ("rewardStatus" IS NULL OR "rewardStatus" IN ('NONE', 'OPEN', 'AWARDED', 'CANCELLED'));

-- CreateIndex
CREATE INDEX "Task_orgId_rewardStatus_idx" ON "Task"("orgId", "rewardStatus");

-- CreateIndex
CREATE INDEX "Task_workspaceId_pinnedAt_idx" ON "Task"("workspaceId", "pinnedAt");
