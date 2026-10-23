-- Phase 3, step 2 of 3 (data only): give the chat the rooms it needs on deploy day.
--
-- Until now the chat had private chats (DM) and groups, and nobody but their members could read them.
-- From this release a team talks in a SPACE with TOPICS (a space is visible only to the people in it and
-- to the OWNER, who reads everything silently and so is in NO space or topic row). This migration creates:
--
--   1. HQ, one space per company (id ws_hq_<companyId>, key "hq"), with five topics
--      (id cv_hq_<key>_<companyId>): التنبيهات (announcements, admins post) · المتابعة (follow-up, admins
--      post) · عام · الأفكار · الأرشيف (restricted, nobody is a member: only the owner reads it).
--      Everybody ACTIVE who is not the owner and not a guest is in HQ (an ADMIN as space ADMIN).
--   2. one space per department (id ws_dept_<departmentId>) with its people - the lead is the space
--      ADMIN - and a general topic (id cv_dept_<departmentId>).
--   3. one space per legacy GROUP conversation (id ws_grp_<conversationId>): the group's people are the
--      space's people (a group admin becomes a space ADMIN), and the conversation ITSELF becomes the
--      general topic of that space - same id, same messages, same read marks, nothing copied or lost.
--      The old title and emoji become the space's name and emoji.
--   4. the key of every DM (min|max of its two user ids, plain code-unit order): only the OLDEST DM of a
--      pair in a company gets it, so the unique index can never collide; the duplicates of old data stay
--      readable and simply keep no key.
--
-- Who is put anywhere: only ACTIVE members of the company. Never the OWNER (no row anywhere), never a
-- GUEST (an external partner is put in a space by a person, on purpose), never a suspended or offboarded
-- person (someone who is reactivated is added back by a space admin; HQ is restored by the application).
--
-- Safe to run again (the owner's rule for data moves): every row has a fixed id and is inserted with
-- ON CONFLICT DO NOTHING; every UPDATE selects only rows that still need it, so a second run changes
-- nothing, and a run after new companies or late legacy groups appeared completes exactly those.
-- The ids and names below are the ones the application uses for HQ (src/server/chat/hq.ts), so running
-- the application's own "ensure HQ" on a migrated database is a no-op.

-- 1a. HQ: one space per company. The slug is "hq"; if the company already has a space of that slug
--     (a person's own), the HQ takes a slug that cannot collide.
INSERT INTO "Workspace" ("id", "organizationId", "name", "slug", "kind", "emoji", "systemKey", "createdAt", "updatedAt")
SELECT 'ws_hq_' || o."id",
       o."id",
       'المقر',
       CASE
         WHEN EXISTS (
           SELECT 1 FROM "Workspace" w
           WHERE w."organizationId" = o."id" AND w."slug" = 'hq' AND w."id" <> 'ws_hq_' || o."id"
         ) THEN 'hq-' || o."id"
         ELSE 'hq'
       END,
       'HQ'::"WorkspaceKind",
       '🕌',
       'hq',
       now(),
       now()
FROM "Organization" o
ON CONFLICT DO NOTHING;

-- 1b. HQ: its people. ADMIN -> space ADMIN, everybody else (LEAD, MEMBER) -> MEMBER.
INSERT INTO "WorkspaceMember" ("id", "workspaceId", "userId", "role", "createdAt")
SELECT 'wm_p3_ws_hq_' || om."organizationId" || '_' || om."userId",
       'ws_hq_' || om."organizationId",
       om."userId",
       (CASE WHEN om."role" = 'ADMIN' THEN 'ADMIN' ELSE 'MEMBER' END)::"WorkspaceRole",
       now()
FROM "OrganizationMember" om
WHERE om."status" = 'ACTIVE'
  AND om."role" NOT IN ('OWNER', 'GUEST')
  AND EXISTS (SELECT 1 FROM "Workspace" w WHERE w."id" = 'ws_hq_' || om."organizationId")
ON CONFLICT DO NOTHING;

-- 1c. HQ: its five topics. No member rows: a topic that is not restricted belongs to everybody in the space,
--     and the archive topic is restricted with nobody in it.
INSERT INTO "Conversation" ("id", "orgId", "kind", "title", "emoji", "spaceId", "topicType", "postingPolicy", "restricted", "position", "systemKey", "createdAt", "updatedAt")
SELECT 'cv_hq_' || t."key" || '_' || o."id",
       o."id",
       'TOPIC',
       t."title",
       t."emoji",
       'ws_hq_' || o."id",
       t."topicType",
       t."postingPolicy",
       t."restricted",
       t."position",
       t."key",
       now(),
       now()
FROM "Organization" o
CROSS JOIN (
  VALUES
    ('announcements', 'التنبيهات', '📢', 'ANNOUNCEMENTS', 'ADMINS', false, 0),
    ('followup', 'المتابعة', '🔁', 'FOLLOWUP', 'ADMINS', false, 1),
    ('general', 'عام', '💬', 'DISCUSSION', 'ALL', false, 2),
    ('ideas', 'الأفكار', '💡', 'IDEAS', 'ALL', false, 3),
    ('archive', 'الأرشيف', '🗄️', 'DISCUSSION', 'ALL', true, 4)
) AS t ("key", "title", "emoji", "topicType", "postingPolicy", "restricted", "position")
WHERE EXISTS (SELECT 1 FROM "Workspace" w WHERE w."id" = 'ws_hq_' || o."id")
ON CONFLICT DO NOTHING;

-- 2a. Departments: a space each, named like the department.
INSERT INTO "Workspace" ("id", "organizationId", "name", "slug", "kind", "emoji", "departmentId", "createdAt", "updatedAt")
SELECT 'ws_dept_' || d."id",
       d."orgId",
       d."name",
       'dept-' || d."id",
       'DEPARTMENT'::"WorkspaceKind",
       d."emoji",
       d."id",
       d."createdAt",
       now()
FROM "Department" d
ON CONFLICT DO NOTHING;

-- 2b. Departments: their people. A department's lead is the space ADMIN - whether the lead is marked on
--     the roster (role 'lead') or named in Department.leadId (who may not be on the roster at all).
INSERT INTO "WorkspaceMember" ("id", "workspaceId", "userId", "role", "createdAt")
SELECT 'wm_p3_ws_dept_' || r."departmentId" || '_' || r."userId",
       'ws_dept_' || r."departmentId",
       r."userId",
       (CASE WHEN r."isLead" THEN 'ADMIN' ELSE 'MEMBER' END)::"WorkspaceRole",
       now()
FROM (
  SELECT x."departmentId", x."userId", bool_or(x."isLead") AS "isLead"
  FROM (
    SELECT dm."departmentId", dm."userId", (dm."role" = 'lead') AS "isLead"
    FROM "DepartmentMember" dm
    UNION ALL
    SELECT dd."id", dd."leadId", true
    FROM "Department" dd
    WHERE dd."leadId" IS NOT NULL
  ) x
  GROUP BY x."departmentId", x."userId"
) r
JOIN "Department" d ON d."id" = r."departmentId"
JOIN "OrganizationMember" om ON om."organizationId" = d."orgId" AND om."userId" = r."userId"
WHERE om."status" = 'ACTIVE'
  AND om."role" NOT IN ('OWNER', 'GUEST')
  AND EXISTS (SELECT 1 FROM "Workspace" w WHERE w."id" = 'ws_dept_' || r."departmentId")
ON CONFLICT DO NOTHING;

-- 2c. Departments: the general topic.
INSERT INTO "Conversation" ("id", "orgId", "kind", "title", "emoji", "spaceId", "systemKey", "createdAt", "updatedAt")
SELECT 'cv_dept_' || d."id",
       d."orgId",
       'TOPIC',
       'عام',
       '💬',
       'ws_dept_' || d."id",
       'general',
       now(),
       now()
FROM "Department" d
WHERE EXISTS (SELECT 1 FROM "Workspace" w WHERE w."id" = 'ws_dept_' || d."id")
ON CONFLICT DO NOTHING;

-- 3a. Legacy groups: a space each. The group's title and emoji become the space's name and emoji
--     (a blank title, which the application never wrote, gets a plain name); it dates from the group.
INSERT INTO "Workspace" ("id", "organizationId", "name", "slug", "kind", "emoji", "createdAt", "updatedAt")
SELECT 'ws_grp_' || c."id",
       c."orgId",
       COALESCE(NULLIF(btrim(c."title"), ''), 'مجموعة'),
       'grp-' || c."id",
       'STANDARD'::"WorkspaceKind",
       c."emoji",
       c."createdAt",
       now()
FROM "Conversation" c
WHERE c."kind" = 'GROUP'
ON CONFLICT DO NOTHING;

-- 3b. Legacy groups: the group's people. A group admin becomes a space ADMIN, the others MEMBERs.
--     A group never had a guest (chat was closed to them) and the owner reads without a row, so neither
--     is added; the conversation rows of everybody - the owner's, a suspended person's - stay as they are.
INSERT INTO "WorkspaceMember" ("id", "workspaceId", "userId", "role", "createdAt")
SELECT 'wm_p3_ws_grp_' || c."id" || '_' || cm."userId",
       'ws_grp_' || c."id",
       cm."userId",
       (CASE WHEN cm."role" = 'admin' THEN 'ADMIN' ELSE 'MEMBER' END)::"WorkspaceRole",
       cm."joinedAt"
FROM "Conversation" c
JOIN "ConversationMember" cm ON cm."conversationId" = c."id"
JOIN "OrganizationMember" om ON om."organizationId" = c."orgId" AND om."userId" = cm."userId"
WHERE c."kind" = 'GROUP'
  AND om."status" = 'ACTIVE'
  AND om."role" NOT IN ('OWNER', 'GUEST')
  AND EXISTS (SELECT 1 FROM "Workspace" w WHERE w."id" = 'ws_grp_' || c."id")
ON CONFLICT DO NOTHING;

-- 3c. Legacy groups: the conversation itself becomes the general topic of its space. Same id, so its
--     messages, replies, reactions, pins and every member's read mark are untouched; nothing is copied.
UPDATE "Conversation" c
SET "kind" = 'TOPIC',
    "title" = 'عام',
    "emoji" = '💬',
    "spaceId" = 'ws_grp_' || c."id",
    "systemKey" = 'general'
WHERE c."kind" = 'GROUP'
  AND EXISTS (SELECT 1 FROM "Workspace" w WHERE w."id" = 'ws_grp_' || c."id")
  AND NOT EXISTS (
    SELECT 1 FROM "Conversation" t
    WHERE t."spaceId" = 'ws_grp_' || c."id" AND t."systemKey" = 'general'
  );

-- 4. DMs: the key of the OLDEST DM of each pair in a company (ties on the creation time go to the smaller
--    id). Only a DM with exactly two people has a pair. The two ids are ordered the way the application
--    orders them (plain code-unit order, hence COLLATE "C"), never by the database's language rules.
UPDATE "Conversation" c
SET "dmKey" = oldest."dmKey"
FROM (
  SELECT DISTINCT ON (p."orgId", p."dmKey") p."id", p."dmKey"
  FROM (
    SELECT dm."id", dm."orgId", dm."createdAt", pair."dmKey"
    FROM "Conversation" dm
    JOIN (
      SELECT cm."conversationId",
             min(cm."userId" COLLATE "C") || '|' || max(cm."userId" COLLATE "C") AS "dmKey"
      FROM "ConversationMember" cm
      GROUP BY cm."conversationId"
      HAVING count(*) = 2
    ) pair ON pair."conversationId" = dm."id"
    WHERE dm."kind" = 'DM'
  ) p
  ORDER BY p."orgId", p."dmKey", p."createdAt", p."id" COLLATE "C"
) oldest
WHERE c."id" = oldest."id"
  AND c."dmKey" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "Conversation" other
    WHERE other."orgId" = c."orgId" AND other."dmKey" = oldest."dmKey"
  );
