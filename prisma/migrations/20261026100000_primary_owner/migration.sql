-- Partners as owners (the owner's decision, 2026-10-26): the company's first OWNER is its primary owner, the only one who
-- adds or removes another OWNER and takes a permission away from one. Additive: one column, then each company's
-- oldest OWNER row is marked.

-- AlterTable
ALTER TABLE "OrganizationMember" ADD COLUMN "primaryOwner" BOOLEAN NOT NULL DEFAULT false;

-- Data: the oldest OWNER of each company
UPDATE "OrganizationMember" m
SET "primaryOwner" = true
WHERE m."role" = 'OWNER'
  AND m."id" = (
    SELECT o."id" FROM "OrganizationMember" o
    WHERE o."organizationId" = m."organizationId" AND o."role" = 'OWNER'
    ORDER BY o."createdAt" ASC, o."id" ASC
    LIMIT 1
  );
