-- Each space has its own ideas (the owner's decision, 2026-10-25), and «شارك مع الشركة» shows one in «الشركة» too.
-- Additive only: two nullable columns, an index, a foreign key that empties the column when a space is deleted.
-- Existing ideas keep no space: they are read in «الشركة», so nothing disappears.

-- AlterTable
ALTER TABLE "Idea" ADD COLUMN "sharedAt" TIMESTAMP(3),
ADD COLUMN "workspaceId" TEXT;

-- CreateIndex
CREATE INDEX "Idea_orgId_workspaceId_idx" ON "Idea"("orgId", "workspaceId");

-- AddForeignKey
ALTER TABLE "Idea" ADD CONSTRAINT "Idea_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;
