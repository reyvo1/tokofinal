ALTER TABLE "ReportJob" ADD COLUMN IF NOT EXISTS "scheduleId" TEXT;
ALTER TABLE "ReportJob" ADD COLUMN IF NOT EXISTS "scheduledFor" TIMESTAMP(3);
CREATE UNIQUE INDEX IF NOT EXISTS "ReportJob_scheduleId_scheduledFor_key" ON "ReportJob"("scheduleId", "scheduledFor");
CREATE INDEX IF NOT EXISTS "ReportJob_scheduleId_createdAt_idx" ON "ReportJob"("scheduleId", "createdAt");

CREATE TABLE IF NOT EXISTS "ReportSchedule" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "requestedById" TEXT,
  "name" TEXT NOT NULL,
  "reportType" TEXT NOT NULL,
  "format" TEXT NOT NULL DEFAULT 'CSV',
  "filters" JSONB,
  "frequency" TEXT NOT NULL,
  "localTime" TEXT NOT NULL,
  "dayOfWeek" INTEGER,
  "dayOfMonth" INTEGER,
  "timezone" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "nextRunAt" TIMESTAMP(3) NOT NULL,
  "lastRunAt" TIMESTAMP(3),
  "lastJobId" TEXT,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReportSchedule_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ReportSchedule_companyId_branchId_name_key" ON "ReportSchedule"("companyId", "branchId", "name");
CREATE INDEX IF NOT EXISTS "ReportSchedule_isActive_nextRunAt_idx" ON "ReportSchedule"("isActive", "nextRunAt");
CREATE INDEX IF NOT EXISTS "ReportSchedule_companyId_branchId_isActive_idx" ON "ReportSchedule"("companyId", "branchId", "isActive");
DO $$ BEGIN
  ALTER TABLE "ReportSchedule" ADD CONSTRAINT "ReportSchedule_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ReportSchedule" ADD CONSTRAINT "ReportSchedule_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ReportJob" ADD CONSTRAINT "ReportJob_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "ReportSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
