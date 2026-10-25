-- Topics can be archived (out of the list, read-only, nothing deleted) and pinned on top (the owner's ask,
-- 2026-10-25: close, delete, pin). Additive only: two nullable columns.

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN "archivedAt" TIMESTAMP(3),
ADD COLUMN "pinnedAt" TIMESTAMP(3);
