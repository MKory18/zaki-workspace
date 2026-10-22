-- Phase 3, step 1 of 3: the structure of the chat (spaces with topics, private chats, edits and deletes
-- that keep an archive, attachments and voice, the realtime bus).
-- Additive only. Every new column is nullable or has a default, so the rows that exist stay valid and the
-- previous release keeps working against this schema (it knows none of the new columns and never writes them).
-- Structure only: the rows that fill it (HQ, department spaces, groups turned into spaces, DM keys) are the
-- next migration; the realtime trigger is the one after.

-- CreateEnum
CREATE TYPE "WorkspaceKind" AS ENUM ('STANDARD', 'DEPARTMENT', 'HQ');

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "conversationId" TEXT,
ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN     "clientId" TEXT,
ADD COLUMN     "deletedById" TEXT,
ADD COLUMN     "forwardedFromId" TEXT,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'TEXT',
ADD COLUMN     "mentions" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "dmKey" TEXT,
ADD COLUMN     "position" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "postingPolicy" TEXT NOT NULL DEFAULT 'ALL',
ADD COLUMN     "restricted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "spaceId" TEXT,
ADD COLUMN     "systemKey" TEXT,
ADD COLUMN     "topicType" TEXT NOT NULL DEFAULT 'DISCUSSION';

-- AlterTable
ALTER TABLE "ConversationMember" ADD COLUMN     "lastDeliveredAt" TIMESTAMP(3),
ADD COLUMN     "mutedUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "StoredFile" ADD COLUMN     "purpose" TEXT NOT NULL DEFAULT 'LIBRARY';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lastSeenAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "departmentId" TEXT,
ADD COLUMN     "emoji" TEXT,
ADD COLUMN     "kind" "WorkspaceKind" NOT NULL DEFAULT 'STANDARD',
ADD COLUMN     "systemKey" TEXT;

-- AlterTable
ALTER TABLE "WorkspaceMember" ADD COLUMN     "mutedUntil" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "MessageRevision" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "editorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageNote" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
-- "messageId" is NULL while an upload waits to be claimed by its message.
CREATE TABLE "MessageAttachment" (
    "id" TEXT NOT NULL,
    "messageId" TEXT,
    "fileId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "durationMs" INTEGER,
    "peaks" JSONB,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RealtimeEvent" (
    "id" BIGSERIAL NOT NULL,
    "orgId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "ids" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RealtimeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MessageRevision_messageId_createdAt_idx" ON "MessageRevision"("messageId", "createdAt");

-- CreateIndex
CREATE INDEX "MessageNote_messageId_createdAt_idx" ON "MessageNote"("messageId", "createdAt");

-- CreateIndex
CREATE INDEX "MessageAttachment_messageId_position_idx" ON "MessageAttachment"("messageId", "position");

-- CreateIndex
CREATE INDEX "MessageAttachment_fileId_idx" ON "MessageAttachment"("fileId");

-- CreateIndex
CREATE INDEX "RealtimeEvent_createdAt_idx" ON "RealtimeEvent"("createdAt");

-- CreateIndex
CREATE INDEX "RealtimeEvent_orgId_id_idx" ON "RealtimeEvent"("orgId", "id");

-- CreateIndex
CREATE INDEX "AuditLog_conversationId_createdAt_idx" ON "AuditLog"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_workspaceId_createdAt_idx" ON "AuditLog"("workspaceId", "createdAt");

-- CreateIndex
-- A send is idempotent: one author, one clientId (born NULL, and NULLs never collide).
CREATE UNIQUE INDEX "ChatMessage_authorId_clientId_key" ON "ChatMessage"("authorId", "clientId");

-- CreateIndex
CREATE INDEX "Conversation_spaceId_position_idx" ON "Conversation"("spaceId", "position");

-- CreateIndex
-- One DM per pair of people per company. The key column is born NULL, so this cannot fail on the rows
-- that exist; the data move fills it for the OLDEST DM of each pair only, so a duplicate can never collide.
CREATE UNIQUE INDEX "Conversation_orgId_dmKey_key" ON "Conversation"("orgId", "dmKey");

-- CreateIndex
-- A space has at most one topic per system role (announcements, followup, general, ideas, archive).
CREATE UNIQUE INDEX "Conversation_spaceId_systemKey_key" ON "Conversation"("spaceId", "systemKey");

-- CreateIndex
CREATE INDEX "StoredFile_orgId_purpose_idx" ON "StoredFile"("orgId", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_departmentId_key" ON "Workspace"("departmentId");

-- CreateIndex
-- One HQ per company (systemKey "hq").
CREATE UNIQUE INDEX "Workspace_organizationId_systemKey_key" ON "Workspace"("organizationId", "systemKey");

-- AddForeignKey
-- A space that has topics (chat history) can never be deleted.
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_forwardedFromId_fkey" FOREIGN KEY ("forwardedFromId") REFERENCES "ChatMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageRevision" ADD CONSTRAINT "MessageRevision_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageRevision" ADD CONSTRAINT "MessageRevision_editorId_fkey" FOREIGN KEY ("editorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageNote" ADD CONSTRAINT "MessageNote_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageNote" ADD CONSTRAINT "MessageNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageAttachment" ADD CONSTRAINT "MessageAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- The bytes of a file that a message links to are never deleted from under it.
ALTER TABLE "MessageAttachment" ADD CONSTRAINT "MessageAttachment_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "StoredFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
-- Deleting a department keeps its space (the link is cleared).
ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;
