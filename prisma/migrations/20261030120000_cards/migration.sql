-- «لوحات»: a space type whose whole content is cards (notes, prompts, lists, links, files, small tables).
--
-- Additive only. One column on an existing table, WITH a default, so every space that exists keeps the layout it
-- always had (STANDARD); one NEW table, empty, with its own indexes and foreign keys. Nothing is renamed, dropped
-- or rewritten. `Workspace.kind` is not touched: it says who a space is for, `layout` says what it is made of.

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN "layout" TEXT NOT NULL DEFAULT 'STANDARD';

-- CreateTable
CREATE TABLE "Card" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "data" JSONB,
    "color" TEXT NOT NULL DEFAULT 'none',
    "category" TEXT,
    "tags" TEXT[],
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "position" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fileId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Card_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Card_workspaceId_archivedAt_pinned_position_idx" ON "Card"("workspaceId", "archivedAt", "pinned", "position");

-- CreateIndex
CREATE INDEX "Card_orgId_workspaceId_idx" ON "Card"("orgId", "workspaceId");

-- AddForeignKey
ALTER TABLE "Card" ADD CONSTRAINT "Card_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Card" ADD CONSTRAINT "Card_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Card" ADD CONSTRAINT "Card_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Card" ADD CONSTRAINT "Card_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "StoredFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
