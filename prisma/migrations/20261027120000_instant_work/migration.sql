-- AlterTable
ALTER TABLE "Ticket" ALTER COLUMN "departmentId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN "systemKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Project_workspaceId_systemKey_key" ON "Project"("workspaceId", "systemKey");
