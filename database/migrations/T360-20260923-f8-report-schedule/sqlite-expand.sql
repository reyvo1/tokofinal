PRAGMA foreign_keys=ON;

ALTER TABLE "ReportJob" ADD COLUMN "scheduleId" TEXT;
ALTER TABLE "ReportJob" ADD COLUMN "scheduledFor" DATETIME;
CREATE UNIQUE INDEX IF NOT EXISTS "ReportJob_scheduleId_scheduledFor_key" ON "ReportJob"("scheduleId", "scheduledFor");
CREATE INDEX IF NOT EXISTS "ReportJob_scheduleId_createdAt_idx" ON "ReportJob"("scheduleId", "createdAt");

CREATE TABLE IF NOT EXISTS "ReportSchedule" (
  "id" TEXT NOT NULL PRIMARY KEY,
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
  "nextRunAt" DATETIME NOT NULL,
  "lastRunAt" DATETIME,
  "lastJobId" TEXT,
  "lastError" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ReportSchedule_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ReportSchedule_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "ReportSchedule_companyId_branchId_name_key" ON "ReportSchedule"("companyId", "branchId", "name");
CREATE INDEX IF NOT EXISTS "ReportSchedule_isActive_nextRunAt_idx" ON "ReportSchedule"("isActive", "nextRunAt");
CREATE INDEX IF NOT EXISTS "ReportSchedule_companyId_branchId_isActive_idx" ON "ReportSchedule"("companyId", "branchId", "isActive");
