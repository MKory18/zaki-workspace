-- Phase 1, step 2 of 3: account status, session version, capabilities, manager, company time zone.
-- Additive only. Every new column is nullable or has a default, so existing rows stay valid and the
-- application of the previous release keeps working against this schema.

-- CreateEnum
CREATE TYPE "MemberStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'OFFBOARDED');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "settings" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'Asia/Damascus';

-- AlterTable
ALTER TABLE "OrganizationMember" ADD COLUMN     "capabilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "managerId" TEXT,
ADD COLUMN     "omsStaffRef" TEXT,
ADD COLUMN     "revokedCapabilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "status" "MemberStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "statusChangedAt" TIMESTAMP(3),
ADD COLUMN     "statusChangedById" TEXT;

-- AlterTable: e-mail becomes optional (an account may have only a username)
ALTER TABLE "User" ADD COLUMN     "lastLoginAt" TIMESTAMP(3),
ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "tokenVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "transparencyAcceptedAt" TIMESTAMP(3),
ADD COLUMN     "transparencyVersion" INTEGER,
ADD COLUMN     "username" TEXT,
ALTER COLUMN "email" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "OrganizationMember_organizationId_status_idx" ON "OrganizationMember"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationMember_organizationId_omsStaffRef_key" ON "OrganizationMember"("organizationId", "omsStaffRef");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- AddForeignKey
ALTER TABLE "OrganizationMember" ADD CONSTRAINT "OrganizationMember_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
