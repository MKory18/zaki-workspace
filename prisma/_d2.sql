-- CreateEnum
CREATE TYPE "IntegrationType" AS ENUM ('TELEGRAM', 'N8N', 'GOOGLE_DRIVE');

-- CreateTable
CREATE TABLE "Integration" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "type" "IntegrationType" NOT NULL,
    "connected" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB,
    "secretEnc" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Integration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelegramChat" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelegramChat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelegramMessage" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "messageId" INTEGER NOT NULL,
    "fromName" TEXT NOT NULL,
    "fromId" TEXT,
    "text" TEXT,
    "isCommand" BOOLEAN NOT NULL DEFAULT false,
    "sentAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelegramMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationEvent" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB,
    "status" TEXT NOT NULL DEFAULT 'OK',
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "integrationId" TEXT NOT NULL,

    CONSTRAINT "IntegrationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Integration_orgId_type_key" ON "Integration"("orgId", "type");

-- CreateIndex
CREATE INDEX "TelegramChat_orgId_idx" ON "TelegramChat"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramChat_integrationId_chatId_key" ON "TelegramChat"("integrationId", "chatId");

-- CreateIndex
CREATE INDEX "TelegramMessage_orgId_sentAt_idx" ON "TelegramMessage"("orgId", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramMessage_integrationId_chatId_messageId_key" ON "TelegramMessage"("integrationId", "chatId", "messageId");

-- CreateIndex
CREATE INDEX "IntegrationEvent_orgId_createdAt_idx" ON "IntegrationEvent"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "IntegrationEvent_orgId_direction_idx" ON "IntegrationEvent"("orgId", "direction");

-- AddForeignKey
ALTER TABLE "Integration" ADD CONSTRAINT "Integration_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramChat" ADD CONSTRAINT "TelegramChat_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramMessage" ADD CONSTRAINT "TelegramMessage_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationEvent" ADD CONSTRAINT "IntegrationEvent_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationEvent" ADD CONSTRAINT "IntegrationEvent_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

