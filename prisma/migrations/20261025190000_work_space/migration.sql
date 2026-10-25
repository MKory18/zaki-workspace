-- Goals, the daily routines, the customers and the opportunities belong to a space (the owner's decision, 2026-10-25:
-- each space is like a separate site). Additive only: a nullable column, an index and a foreign key (emptied when a
-- space is deleted) on each. Existing rows keep no space: they are read in «الشركة», so nothing disappears.

-- AlterTable
ALTER TABLE "Goal" ADD COLUMN "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "Routine" ADD COLUMN "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "Opportunity" ADD COLUMN "workspaceId" TEXT;

-- CreateIndex
CREATE INDEX "Goal_orgId_workspaceId_idx" ON "Goal"("orgId", "workspaceId");

-- CreateIndex
CREATE INDEX "Routine_orgId_workspaceId_idx" ON "Routine"("orgId", "workspaceId");

-- CreateIndex
CREATE INDEX "Customer_orgId_workspaceId_idx" ON "Customer"("orgId", "workspaceId");

-- CreateIndex
CREATE INDEX "Opportunity_orgId_workspaceId_idx" ON "Opportunity"("orgId", "workspaceId");

-- AddForeignKey
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Routine" ADD CONSTRAINT "Routine_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;
