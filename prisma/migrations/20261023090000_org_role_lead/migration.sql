-- Phase 1, step 1 of 3: the team-lead rank.
-- Enum values live in a migration of their own: a value added here cannot be used in the same
-- transaction, and mixing it with schema changes is how a deploy fails half way.
ALTER TYPE "OrgRole" ADD VALUE IF NOT EXISTS 'LEAD' BEFORE 'MEMBER';
