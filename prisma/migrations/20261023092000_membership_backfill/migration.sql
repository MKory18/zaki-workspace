-- Phase 1, step 3 of 3 (data only): make workspace access explicit.
--
-- Until now an organization ADMIN reached every workspace by inheritance and a plain member could
-- open any workspace by its link (the guard did not check rows). From this release a workspace is
-- visible to the people who are IN it, and to the OWNER, who needs no row at all (the owner's
-- reading is silent: no membership, nothing listed). To avoid locking anybody out on deploy day,
-- admins and members are put into every workspace of their organization (the owner's choice in the
-- plan: nobody is locked out; he trims the list afterwards from the app, and every change is
-- audited). Existing rows are kept. The owner gets none.
--
-- Safe to run twice: rows are created with ON CONFLICT DO NOTHING / guarded updates only.

-- 1. Every ADMIN and MEMBER of an organization gets a row in every workspace of that organization.
--    ADMIN becomes workspace ADMIN; a MEMBER a plain MEMBER. Existing rows are kept, except that an
--    ADMIN's row is raised to ADMIN. The OWNER is left out on purpose (needs no row).
INSERT INTO "WorkspaceMember" ("id", "workspaceId", "userId", "role", "createdAt")
SELECT 'wm_p1_' || w."id" || '_' || om."userId",
       w."id",
       om."userId",
       (CASE WHEN om."role" = 'ADMIN' THEN 'ADMIN' ELSE 'MEMBER' END)::"WorkspaceRole",
       now()
FROM "Workspace" w
JOIN "OrganizationMember" om ON om."organizationId" = w."organizationId"
WHERE om."role" IN ('ADMIN', 'MEMBER')
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
