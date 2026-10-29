-- Review B7: a notification belongs to one company.
--
-- A person may be an ACTIVE member of two companies. Their personal notices (a welcome, a changed rank, a
-- ticket that has no space) carried no company, and `bellWhere` showed every such row in the bell of BOTH
-- companies — so the screen said, in company A, «مرحباً بك في الشركة ب».
--
-- Additive and safe on a database that already has rows: the column is nullable, no default, no rewrite.
-- Old rows stay NULL and keep their current behaviour until `20261029120000_notification_org_backfill` fills
-- them in.

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN "organizationId" TEXT;

-- CreateIndex
CREATE INDEX "Notification_userId_organizationId_readAt_idx" ON "Notification"("userId", "organizationId", "readAt");
