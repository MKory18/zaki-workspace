-- «نتفرّج سوا»: a comment keeps the second of the video it was written at (2026-10-26).
-- Additive only: one nullable column.

-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN     "videoAtSec" DOUBLE PRECISION;

