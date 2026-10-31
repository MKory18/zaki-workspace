-- «الأداء والتطوير», part 2: the criteria, the reviews, the development plan and the 1:1 notes.
--
-- Additive only: four NEW, empty tables with their own indexes and foreign keys (and three new enums). Nothing existing is altered,
-- renamed or rewritten. The score itself is not stored: it is computed from the owner board's numbers and these reviews.

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'SHARED');

-- CreateEnum
CREATE TYPE "ReviewLight" AS ENUM ('GREEN', 'AMBER', 'RED');

-- CreateEnum
CREATE TYPE "DevGoalStatus" AS ENUM ('OPEN', 'DONE', 'CANCELLED');

-- CreateTable
CREATE TABLE "ReviewCriterion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewCriterion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "ratings" JSONB NOT NULL DEFAULT '{}',
    "light" "ReviewLight",
    "strengths" TEXT NOT NULL DEFAULT '',
    "improvement" TEXT NOT NULL DEFAULT '',
    "privateNote" TEXT NOT NULL DEFAULT '',
    "status" "ReviewStatus" NOT NULL DEFAULT 'DRAFT',
    "submittedAt" TIMESTAMP(3),
    "sharedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DevGoal" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "skillId" TEXT,
    "title" TEXT NOT NULL,
    "targetLevel" INTEGER,
    "actions" TEXT NOT NULL DEFAULT '',
    "dueDate" DATE,
    "status" "DevGoalStatus" NOT NULL DEFAULT 'OPEN',
    "proposal" BOOLEAN NOT NULL DEFAULT false,
    "appliedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DevGoal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewNote" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "shared" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReviewCriterion_organizationId_code_key" ON "ReviewCriterion"("organizationId", "code");

-- CreateIndex
CREATE INDEX "Review_organizationId_userId_period_idx" ON "Review"("organizationId", "userId", "period");

-- CreateIndex
CREATE INDEX "Review_organizationId_period_status_idx" ON "Review"("organizationId", "period", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Review_userId_reviewerId_period_version_key" ON "Review"("userId", "reviewerId", "period", "version");

-- CreateIndex
CREATE INDEX "DevGoal_organizationId_userId_status_idx" ON "DevGoal"("organizationId", "userId", "status");

-- CreateIndex
CREATE INDEX "ReviewNote_organizationId_userId_createdAt_idx" ON "ReviewNote"("organizationId", "userId", "createdAt");

-- AddForeignKey
ALTER TABLE "ReviewCriterion" ADD CONSTRAINT "ReviewCriterion_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DevGoal" ADD CONSTRAINT "DevGoal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DevGoal" ADD CONSTRAINT "DevGoal_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewNote" ADD CONSTRAINT "ReviewNote_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A target level is 0..4 and a version starts at 1; the tables are new, so the checks meet no rows.
ALTER TABLE "DevGoal" ADD CONSTRAINT "DevGoal_target_level_check" CHECK ("targetLevel" IS NULL OR "targetLevel" BETWEEN 0 AND 4);
ALTER TABLE "Review" ADD CONSTRAINT "Review_version_check" CHECK ("version" >= 1);
