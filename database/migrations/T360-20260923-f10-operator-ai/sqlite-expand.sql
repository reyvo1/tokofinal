PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS "OperatorInsight" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "companyId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "severity" TEXT NOT NULL DEFAULT 'INFO',
  "title" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "explanation" JSONB NOT NULL,
  "sourceLinks" JSONB NOT NULL,
  "recommendedAction" JSONB,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "createdByRunId" TEXT,
  "firstObservedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastObservedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "acknowledgedAt" DATETIME,
  "acknowledgedById" TEXT,
  "dismissedAt" DATETIME,
  "dismissedById" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);
CREATE INDEX IF NOT EXISTS "OperatorInsight_companyId_branchId_status_severity_idx" ON "OperatorInsight"("companyId","branchId","status","severity");
CREATE INDEX IF NOT EXISTS "OperatorInsight_companyId_branchId_fingerprint_status_idx" ON "OperatorInsight"("companyId","branchId","fingerprint","status");

CREATE TABLE IF NOT EXISTS "AssistantInteraction" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "companyId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "question" TEXT NOT NULL,
  "intent" TEXT NOT NULL,
  "response" JSONB NOT NULL,
  "sourceLinks" JSONB NOT NULL,
  "confidence" DECIMAL NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "AssistantInteraction_companyId_branchId_userId_createdAt_idx" ON "AssistantInteraction"("companyId","branchId","userId","createdAt");
