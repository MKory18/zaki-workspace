-- «مساعد المالك» (the owner, 2026-10-30): an analyst for the owner alone, on top of «لوحة المالك».
-- Additive only: FIVE NEW TABLES (settings, usage counters, conversations, messages, proposals). Nothing existing is touched.
-- The owner's API key is stored ENCRYPTED in "AiSettings"."keyCipher" (never plain text) and is never read back by a route.
-- No foreign keys to the company or the person on purpose (the owner tables are not reachable from the other tables); the
-- messages and the proposals die with their conversation (ON DELETE CASCADE: «امسح المحادثة»).

-- CreateTable
CREATE TABLE "AiSettings" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "keyCipher" TEXT,
    "keyLast4" TEXT,
    "model" TEXT NOT NULL DEFAULT 'claude-sonnet-5-5',
    "dailyLimit" INTEGER NOT NULL DEFAULT 50,
    "monthlyTokenBudget" INTEGER NOT NULL DEFAULT 2000000,
    "allowNames" BOOLEAN NOT NULL DEFAULT false,
    "allowTitles" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiUsage" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "requests" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AiUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiConversation" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "refs" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sentJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiProposal" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "paramsJson" JSONB NOT NULL,
    "reasonText" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "resultJson" JSONB,

    CONSTRAINT "AiProposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiSettings_orgId_key" ON "AiSettings"("orgId");

-- CreateIndex
CREATE INDEX "AiUsage_orgId_day_idx" ON "AiUsage"("orgId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "AiUsage_orgId_userId_day_key" ON "AiUsage"("orgId", "userId", "day");

-- CreateIndex
CREATE INDEX "AiConversation_orgId_userId_updatedAt_idx" ON "AiConversation"("orgId", "userId", "updatedAt");

-- CreateIndex
CREATE INDEX "AiMessage_conversationId_createdAt_idx" ON "AiMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "AiProposal_orgId_status_createdAt_idx" ON "AiProposal"("orgId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "AiProposal_conversationId_createdAt_idx" ON "AiProposal"("conversationId", "createdAt");

-- AddForeignKey
ALTER TABLE "AiMessage" ADD CONSTRAINT "AiMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AiConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiProposal" ADD CONSTRAINT "AiProposal_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AiConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The database refuses what the code refuses: a daily limit from 1 to 10000, a monthly budget from 0 to 100 million tokens,
-- two message roles and five proposal states.
ALTER TABLE "AiSettings" ADD CONSTRAINT "AiSettings_dailyLimit_check" CHECK ("dailyLimit" >= 1 AND "dailyLimit" <= 10000);
ALTER TABLE "AiSettings" ADD CONSTRAINT "AiSettings_monthlyTokenBudget_check" CHECK ("monthlyTokenBudget" >= 0 AND "monthlyTokenBudget" <= 100000000);
ALTER TABLE "AiMessage" ADD CONSTRAINT "AiMessage_role_check" CHECK ("role" IN ('USER', 'ASSISTANT'));
ALTER TABLE "AiProposal" ADD CONSTRAINT "AiProposal_status_check" CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'FAILED'));
