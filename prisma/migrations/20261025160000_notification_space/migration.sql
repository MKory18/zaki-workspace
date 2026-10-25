-- The space a notification belongs to (the owner's decision, 2026-10-25: each space is like a separate site; the bell
-- shows the space the person is in). Additive only: a nullable column, an index, a foreign key that empties the
-- column when a space is deleted. Existing notifications keep no space (personal: shown in every space).

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN "workspaceId" TEXT;

-- CreateIndex
CREATE INDEX "Notification_userId_workspaceId_readAt_idx" ON "Notification"("userId", "workspaceId", "readAt");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;
