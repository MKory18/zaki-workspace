-- «التسجيل اليومي» (daily check-in): a short stand-up per space.
-- Additive only: three new tables, their indexes and foreign keys (to the space and to the round, both ON DELETE CASCADE:
-- a check-in belongs to its space). Nothing existing is touched.

-- CreateTable
CREATE TABLE "CheckinConfig" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "questions" JSONB NOT NULL DEFAULT '[]',
    "timeOfDay" TEXT NOT NULL DEFAULT '09:00',
    "weekdays" INTEGER[] DEFAULT ARRAY[0, 1, 2, 3, 4]::INTEGER[],
    "participantsMode" TEXT NOT NULL DEFAULT 'ALL',
    "participantIds" JSONB NOT NULL DEFAULT '[]',
    "active" BOOLEAN NOT NULL DEFAULT false,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckinConfig_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CheckinConfig_mode" CHECK ("participantsMode" IN ('ALL', 'LIST'))
);

-- CreateTable
CREATE TABLE "CheckinRound" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3) NOT NULL,
    "questions" JSONB NOT NULL DEFAULT '[]',
    "participantIds" JSONB NOT NULL DEFAULT '[]',
    "nudgedAt" TIMESTAMP(3),

    CONSTRAINT "CheckinRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckinAnswer" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "answers" JSONB NOT NULL DEFAULT '[]',
    "taskIds" JSONB NOT NULL DEFAULT '[]',
    "excused" BOOLEAN NOT NULL DEFAULT false,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMP(3),

    CONSTRAINT "CheckinAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CheckinConfig_workspaceId_key" ON "CheckinConfig"("workspaceId");

-- CreateIndex
CREATE INDEX "CheckinRound_day_idx" ON "CheckinRound"("day");

-- CreateIndex: ONE round per space per day (the runner's INSERT ... ON CONFLICT relies on it)
CREATE UNIQUE INDEX "CheckinRound_workspaceId_day_key" ON "CheckinRound"("workspaceId", "day");

-- CreateIndex
CREATE INDEX "CheckinAnswer_userId_idx" ON "CheckinAnswer"("userId");

-- CreateIndex: ONE answer per person per round
CREATE UNIQUE INDEX "CheckinAnswer_roundId_userId_key" ON "CheckinAnswer"("roundId", "userId");

-- AddForeignKey
ALTER TABLE "CheckinConfig" ADD CONSTRAINT "CheckinConfig_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckinRound" ADD CONSTRAINT "CheckinRound_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckinAnswer" ADD CONSTRAINT "CheckinAnswer_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "CheckinRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;
