-- Spaces are put in order by dragging and can be archived (the owner's asks, 2026-10-26). Additive only: two columns.

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN "archivedAt" TIMESTAMP(3),
ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;
