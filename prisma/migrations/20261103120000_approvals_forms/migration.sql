-- «طلبات الموافقة ونماذج» (the owner's backlog, 2026-10-31): approval requests (one approver or a chain of up to three) and
-- reusable form templates.
-- Additive only: FOUR NEW TABLES (ApprovalRequest, ApprovalStep, ApprovalAttachment, FormTemplate). Nothing existing is touched.
-- An approval never moves money: "amountMinor" is a note in integer minor units. Nothing is ever deleted: a cancelled request
-- is a status, a resubmit adds a version, a form edit adds the next version of the template.
-- No foreign keys to the company, the space or the person on purpose (the owner tables); the steps and the files of a request
-- die only with the request (ON DELETE CASCADE), and a request whose form row is gone keeps its answers (SET NULL).

-- CreateTable
CREATE TABLE "ApprovalRequest" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "details" TEXT NOT NULL DEFAULT '',
    "amountMinor" INTEGER,
    "currency" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "version" INTEGER NOT NULL DEFAULT 1,
    "currentStep" INTEGER NOT NULL DEFAULT 1,
    "linkKind" TEXT,
    "linkId" TEXT,
    "formId" TEXT,
    "answers" JSONB,
    "history" JSONB NOT NULL DEFAULT '[]',
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalStep" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "approverId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "notifiedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalAttachment" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "addedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormTemplate" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "schema" JSONB NOT NULL,
    "isLatest" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FormTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ApprovalRequest_workspaceId_status_idx" ON "ApprovalRequest"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "ApprovalRequest_requesterId_idx" ON "ApprovalRequest"("requesterId");

-- CreateIndex
CREATE INDEX "ApprovalRequest_orgId_createdAt_idx" ON "ApprovalRequest"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "ApprovalStep_approverId_status_idx" ON "ApprovalStep"("approverId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalStep_requestId_version_position_key" ON "ApprovalStep"("requestId", "version", "position");

-- CreateIndex
CREATE INDEX "ApprovalAttachment_requestId_idx" ON "ApprovalAttachment"("requestId");

-- CreateIndex
CREATE INDEX "ApprovalAttachment_fileId_idx" ON "ApprovalAttachment"("fileId");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalAttachment_requestId_fileId_version_key" ON "ApprovalAttachment"("requestId", "fileId", "version");

-- CreateIndex
CREATE INDEX "FormTemplate_orgId_workspaceId_isLatest_idx" ON "FormTemplate"("orgId", "workspaceId", "isLatest");

-- CreateIndex
CREATE UNIQUE INDEX "FormTemplate_familyId_version_key" ON "FormTemplate"("familyId", "version");

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_formId_fkey" FOREIGN KEY ("formId") REFERENCES "FormTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalStep" ADD CONSTRAINT "ApprovalStep_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ApprovalRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalAttachment" ADD CONSTRAINT "ApprovalAttachment_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ApprovalRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The database refuses anything the code would never write (text columns, like the reward statuses).
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_status_check" CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'CHANGES_REQUESTED'));
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_amount_check" CHECK (("amountMinor" IS NULL AND "currency" IS NULL) OR ("amountMinor" > 0 AND "amountMinor" <= 100000000 AND "currency" IS NOT NULL));
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_link_check" CHECK (("linkKind" IS NULL AND "linkId" IS NULL) OR ("linkKind" IN ('TASK', 'CARD', 'MESSAGE') AND "linkId" IS NOT NULL));
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_step_check" CHECK ("currentStep" BETWEEN 1 AND 3 AND "version" >= 1);
ALTER TABLE "ApprovalStep" ADD CONSTRAINT "ApprovalStep_status_check" CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED', 'SKIPPED'));
ALTER TABLE "ApprovalStep" ADD CONSTRAINT "ApprovalStep_position_check" CHECK ("position" BETWEEN 1 AND 3);
