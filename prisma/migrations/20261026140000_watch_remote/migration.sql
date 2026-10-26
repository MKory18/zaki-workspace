-- «نتفرّج سوا», the remote (2026-10-26): the order of its changes, «الكل بيتحكّم», and who started a session
-- (the remote may move to somebody else). Additive only: columns with defaults or nullable, and a key.

-- AlterTable
ALTER TABLE "WatchSession" ADD COLUMN     "everyoneControls" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "startedById" TEXT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;

-- AddForeignKey
ALTER TABLE "WatchSession" ADD CONSTRAINT "WatchSession_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

