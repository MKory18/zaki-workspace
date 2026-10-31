-- «حقول مخصصة»: custom fields on the tasks of a project.
-- Additive only: two new tables (the project's field schema and the values tasks hold), their indexes and foreign keys.
-- A field dies with its project and a value dies with its task or its field.

-- CreateTable
CREATE TABLE "ProjectField" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "position" DECIMAL(22,10) NOT NULL,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB NOT NULL DEFAULT '{}',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskFieldValue" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "valueText" TEXT,
    "valueNumber" DECIMAL(18,4),
    "valueDate" DATE,
    "valueJson" JSONB,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskFieldValue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectField_projectId_position_idx" ON "ProjectField"("projectId", "position");

-- CreateIndex
CREATE INDEX "ProjectField_orgId_idx" ON "ProjectField"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskFieldValue_taskId_fieldId_key" ON "TaskFieldValue"("taskId", "fieldId");

-- CreateIndex
CREATE INDEX "TaskFieldValue_fieldId_valueNumber_idx" ON "TaskFieldValue"("fieldId", "valueNumber");

-- CreateIndex
CREATE INDEX "TaskFieldValue_fieldId_valueDate_idx" ON "TaskFieldValue"("fieldId", "valueDate");

-- CreateIndex
CREATE INDEX "TaskFieldValue_fieldId_valueText_idx" ON "TaskFieldValue"("fieldId", "valueText");

-- CreateIndex
CREATE INDEX "TaskFieldValue_orgId_idx" ON "TaskFieldValue"("orgId");

-- AddForeignKey
ALTER TABLE "ProjectField" ADD CONSTRAINT "ProjectField_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskFieldValue" ADD CONSTRAINT "TaskFieldValue_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskFieldValue" ADD CONSTRAINT "TaskFieldValue_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "ProjectField"("id") ON DELETE CASCADE ON UPDATE CASCADE;
