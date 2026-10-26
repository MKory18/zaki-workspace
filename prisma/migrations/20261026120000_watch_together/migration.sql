-- «نتفرّج سوا» (the owner's ask, 2026-10-26): a link a space watches together, its talk a restricted topic.
-- Additive only: one new table, its indexes and keys.

-- CreateTable
CREATE TABLE "WatchSession" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sourceKind" TEXT NOT NULL,
    "sourceRef" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "playing" BOOLEAN NOT NULL DEFAULT false,
    "positionSec" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "stateAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WatchSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WatchSession_conversationId_key" ON "WatchSession"("conversationId");

-- CreateIndex
CREATE INDEX "WatchSession_spaceId_createdAt_idx" ON "WatchSession"("spaceId", "createdAt");

-- CreateIndex
CREATE INDEX "WatchSession_orgId_idx" ON "WatchSession"("orgId");

-- CreateIndex
CREATE INDEX "WatchSession_hostId_idx" ON "WatchSession"("hostId");

-- AddForeignKey
ALTER TABLE "WatchSession" ADD CONSTRAINT "WatchSession_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchSession" ADD CONSTRAINT "WatchSession_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchSession" ADD CONSTRAINT "WatchSession_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchSession" ADD CONSTRAINT "WatchSession_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

