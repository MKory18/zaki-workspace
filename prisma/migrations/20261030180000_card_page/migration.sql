-- The page inside a card: versions, notes, stars, a gallery and an approval status.
--
-- Additive only. Three columns on "Card", each WITH a default (status DRAFT, version 1) or nullable (cover), so every
-- card that exists keeps working; four NEW tables, empty, with their own indexes and foreign keys. Nothing is renamed,
-- dropped or rewritten.

-- AlterTable
ALTER TABLE "Card" ADD COLUMN     "coverFileId" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "CardRevision" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "data" JSONB,
    "color" TEXT NOT NULL DEFAULT 'none',
    "category" TEXT,
    "tags" TEXT[],
    "fileId" TEXT,
    "editorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardNote" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'PUBLIC',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,

    CONSTRAINT "CardNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardRating" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stars" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CardRating_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardAttachment" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "caption" TEXT,
    "addedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CardRevision_cardId_createdAt_idx" ON "CardRevision"("cardId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CardRevision_cardId_version_key" ON "CardRevision"("cardId", "version");

-- CreateIndex
CREATE INDEX "CardNote_cardId_visibility_createdAt_idx" ON "CardNote"("cardId", "visibility", "createdAt");

-- CreateIndex
CREATE INDEX "CardNote_authorId_cardId_idx" ON "CardNote"("authorId", "cardId");

-- CreateIndex
CREATE UNIQUE INDEX "CardRating_cardId_userId_key" ON "CardRating"("cardId", "userId");

-- CreateIndex
CREATE INDEX "CardAttachment_cardId_position_idx" ON "CardAttachment"("cardId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "CardAttachment_cardId_fileId_key" ON "CardAttachment"("cardId", "fileId");

-- AddForeignKey
ALTER TABLE "Card" ADD CONSTRAINT "Card_coverFileId_fkey" FOREIGN KEY ("coverFileId") REFERENCES "StoredFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardRevision" ADD CONSTRAINT "CardRevision_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardRevision" ADD CONSTRAINT "CardRevision_editorId_fkey" FOREIGN KEY ("editorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardNote" ADD CONSTRAINT "CardNote_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardNote" ADD CONSTRAINT "CardNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardRating" ADD CONSTRAINT "CardRating_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardRating" ADD CONSTRAINT "CardRating_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardAttachment" ADD CONSTRAINT "CardAttachment_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardAttachment" ADD CONSTRAINT "CardAttachment_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "StoredFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardAttachment" ADD CONSTRAINT "CardAttachment_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A rating is 1..5 stars; the database says so as well as the service (the table is new, so the check meets no rows).
ALTER TABLE "CardRating" ADD CONSTRAINT "CardRating_stars_check" CHECK ("stars" BETWEEN 1 AND 5);

-- A note is public or private, nothing else.
ALTER TABLE "CardNote" ADD CONSTRAINT "CardNote_visibility_check" CHECK ("visibility" IN ('PUBLIC', 'PRIVATE'));

-- A revision is history: it is written once and never changed. (A DELETE is left alone on purpose: removing a company
-- cascades through its cards, and that must keep working.)
CREATE OR REPLACE FUNCTION "CardRevision_refuse_update"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'card revisions are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "CardRevision_append_only"
  BEFORE UPDATE ON "CardRevision"
  FOR EACH ROW EXECUTE FUNCTION "CardRevision_refuse_update"();
