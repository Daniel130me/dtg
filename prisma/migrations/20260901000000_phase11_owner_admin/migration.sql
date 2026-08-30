-- CreateEnum
CREATE TYPE "ExportType" AS ENUM ('ENROLMENTS', 'STUDENTS');

-- CreateEnum
CREATE TYPE "ExportJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'EXPIRED');

-- CreateTable
CREATE TABLE "ExportJob" (
    "id" UUID NOT NULL,
    "requestedByUserId" UUID NOT NULL,
    "type" "ExportType" NOT NULL,
    "status" "ExportJobStatus" NOT NULL DEFAULT 'PENDING',
    "filters" JSONB,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "content" TEXT,
    "error" VARCHAR(500),
    "expiresAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "downloadCount" INTEGER NOT NULL DEFAULT 0,
    "downloadedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExportJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExportJob_requestedByUserId_createdAt_idx" ON "ExportJob"("requestedByUserId", "createdAt");

-- CreateIndex
CREATE INDEX "ExportJob_status_expiresAt_idx" ON "ExportJob"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "Enrolment_status_createdAt_idx" ON "Enrolment"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "ExportJob" ADD CONSTRAINT "ExportJob_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

