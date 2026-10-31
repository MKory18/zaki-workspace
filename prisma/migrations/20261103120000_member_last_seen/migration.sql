-- AlterTable
-- «آخر ظهور» (the owner, 2026-10-31): when a member was last at their screen in this company, and their own
-- «إخفاء آخر ظهوري» choice. Both nullable / defaulted, so nothing existing changes and nothing is rewritten.
ALTER TABLE "OrganizationMember" ADD COLUMN     "hideLastSeen" BOOLEAN DEFAULT false,
ADD COLUMN     "lastSeenAt" TIMESTAMP(3);
