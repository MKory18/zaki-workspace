-- A chat message can be turned into a task or a ticket (the owner's ask, 2026-10-25); the task or the ticket keeps
-- the message it came from. Additive only: two nullable columns, their indexes and foreign keys (SET NULL).

-- AlterTable
ALTER TABLE "Task" ADD COLUMN "sourceMessageId" TEXT;

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN "sourceMessageId" TEXT;

-- CreateIndex
CREATE INDEX "Task_sourceMessageId_idx" ON "Task"("sourceMessageId");

-- CreateIndex
CREATE INDEX "Ticket_sourceMessageId_idx" ON "Ticket"("sourceMessageId");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_sourceMessageId_fkey" FOREIGN KEY ("sourceMessageId") REFERENCES "ChatMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_sourceMessageId_fkey" FOREIGN KEY ("sourceMessageId") REFERENCES "ChatMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
