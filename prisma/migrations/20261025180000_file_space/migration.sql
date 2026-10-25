-- Each space has its own library (the owner's decision, 2026-10-25: a space is like a separate site). Additive only:
-- a nullable column, an index, a foreign key that empties the column when a space is deleted. Existing files keep no
-- space: they are read in «الشركة», so nothing disappears. Chat files keep none (they go with their conversation).

-- AlterTable
ALTER TABLE "StoredFile" ADD COLUMN "workspaceId" TEXT;

-- CreateIndex
CREATE INDEX "StoredFile_orgId_workspaceId_idx" ON "StoredFile"("orgId", "workspaceId");

-- AddForeignKey
ALTER TABLE "StoredFile" ADD CONSTRAINT "StoredFile_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;
