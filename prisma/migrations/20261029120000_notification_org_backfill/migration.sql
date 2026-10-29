-- Review B7, second half: the rows that existed before the column did.
--
-- Two steps, both safe to repeat and safe on an empty table:
--   1. a notice of a space takes that space's company (the only true answer for it);
--   2. a notice with no space, whose owner is an ACTIVE member of exactly ONE company, takes that company.
--      A person in TWO companies keeps NULL: we cannot know which company wrote it, and NULL stays visible in
--      both bells — the old behaviour for those rows, never a notice in the wrong place.
--
-- A row already filled in is not touched again (both statements skip it), so a second run does nothing.

UPDATE "Notification" AS n
SET "organizationId" = w."organizationId"
FROM "Workspace" AS w
WHERE n."workspaceId" = w."id" AND n."organizationId" IS NULL;

UPDATE "Notification" AS n
SET "organizationId" = m."organizationId"
FROM "OrganizationMember" AS m
WHERE n."organizationId" IS NULL
  AND n."workspaceId" IS NULL
  AND n."userId" = m."userId"
  AND m."status" = 'ACTIVE'
  AND (SELECT count(*) FROM "OrganizationMember" AS o WHERE o."userId" = n."userId" AND o."status" = 'ACTIVE') = 1;
