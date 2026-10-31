-- «الأداء والتطوير», part 1: the skills checklist and its history.
--
-- Additive only: three NEW, empty tables with their own indexes and foreign keys (and one new enum). Nothing existing is
-- altered, renamed or rewritten: the reporting lines use "OrganizationMember"."managerId", which already exists.

-- CreateEnum
CREATE TYPE "SkillSource" AS ENUM ('MANUAL', 'SELF');

-- CreateTable
CREATE TABLE "Skill" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "archivedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Skill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonSkill" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "source" "SkillSource" NOT NULL,
    "level" INTEGER NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonSkill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonSkillHistory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "source" "SkillSource" NOT NULL,
    "oldLevel" INTEGER,
    "newLevel" INTEGER NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "reason" TEXT NOT NULL DEFAULT '',
    "changedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonSkillHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Skill_organizationId_archivedAt_idx" ON "Skill"("organizationId", "archivedAt");

-- CreateIndex
CREATE INDEX "PersonSkill_organizationId_userId_idx" ON "PersonSkill"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "PersonSkill_skillId_idx" ON "PersonSkill"("skillId");

-- CreateIndex
CREATE UNIQUE INDEX "PersonSkill_userId_skillId_source_key" ON "PersonSkill"("userId", "skillId", "source");

-- CreateIndex
CREATE INDEX "PersonSkillHistory_userId_skillId_createdAt_idx" ON "PersonSkillHistory"("userId", "skillId", "createdAt");

-- CreateIndex
CREATE INDEX "PersonSkillHistory_organizationId_createdAt_idx" ON "PersonSkillHistory"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "Skill" ADD CONSTRAINT "Skill_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonSkill" ADD CONSTRAINT "PersonSkill_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonSkill" ADD CONSTRAINT "PersonSkill_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonSkillHistory" ADD CONSTRAINT "PersonSkillHistory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A level is 0..4 (0 لا يعرف ... 4 يعلّم غيره); the tables are new, so the checks meet no rows.
ALTER TABLE "PersonSkill" ADD CONSTRAINT "PersonSkill_level_check" CHECK ("level" BETWEEN 0 AND 4);
ALTER TABLE "PersonSkillHistory" ADD CONSTRAINT "PersonSkillHistory_level_check" CHECK ("newLevel" BETWEEN 0 AND 4 AND ("oldLevel" IS NULL OR "oldLevel" BETWEEN 0 AND 4));

-- The history is written once and never changed. (A DELETE is left alone on purpose: removing a company cascades
-- through its tables, and that must keep working.)
CREATE OR REPLACE FUNCTION "PersonSkillHistory_refuse_update"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'skill history is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PersonSkillHistory_append_only"
  BEFORE UPDATE ON "PersonSkillHistory"
  FOR EACH ROW EXECUTE FUNCTION "PersonSkillHistory_refuse_update"();
