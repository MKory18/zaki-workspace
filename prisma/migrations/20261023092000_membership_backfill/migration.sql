-- Phase 1, step 3 of 3 (data only): make workspace access explicit.
--
-- Until now an organization OWNER/ADMIN reached every workspace by inheritance and a plain member
-- passed most checks without any WorkspaceMember row. From this release a workspace is visible to
-- the people who are IN it (and to the owner). To avoid locking anybody out on deploy day, today's
-- access is copied into explicit rows. The owner then removes what should not be there, from the
-- app, and every such change is audited.
--
-- Safe to run twice: rows are created with ON CONFLICT DO NOTHING / guarded updates only.

-- 1. Every non-guest member of an organization gets a row in every workspace of that organization.
--    OWNER and ADMIN become workspace ADMIN; everybody else a plain MEMBER. Existing rows are kept,
--    except that an OWNER/ADMIN row is raised to ADMIN.
INSERT INTO "WorkspaceMember" ("id", "workspaceId", "userId", "role", "createdAt")
SELECT 'wm_p1_' || w."id" || '_' || om."userId",
       w."id",
       om."userId",
       (CASE WHEN om."role" IN ('OWNER', 'ADMIN') THEN 'ADMIN' ELSE 'MEMBER' END)::"WorkspaceRole",
       now()
FROM "Workspace" w
JOIN "OrganizationMember" om ON om."organizationId" = w."organizationId"
WHERE om."role" IN ('OWNER', 'ADMIN', 'MEMBER')
ON CONFLICT ("workspaceId", "userId") DO UPDATE SET "role" = 'ADMIN'
  WHERE EXCLUDED."role" = 'ADMIN' AND "WorkspaceMember"."role" <> 'ADMIN';

-- 2. An organization guest (an external partner) is a guest in every workspace they are in.
UPDATE "WorkspaceMember" wm
SET "role" = 'GUEST'
FROM "Workspace" w
JOIN "OrganizationMember" om ON om."organizationId" = w."organizationId"
WHERE wm."workspaceId" = w."id"
  AND om."userId" = wm."userId"
  AND om."role" = 'GUEST'
  AND wm."role" <> 'GUEST';
