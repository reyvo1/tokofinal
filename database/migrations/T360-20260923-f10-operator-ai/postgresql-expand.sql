CREATE TABLE IF NOT EXISTS "OperatorInsight" (
  "id" TEXT NOT NULL,
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
  "firstObservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastObservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "acknowledgedAt" TIMESTAMP(3),
  "acknowledgedById" TEXT,
  "dismissedAt" TIMESTAMP(3),
  "dismissedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OperatorInsight_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "OperatorInsight_companyId_branchId_status_severity_idx" ON "OperatorInsight"("companyId","branchId","status","severity");
CREATE INDEX IF NOT EXISTS "OperatorInsight_companyId_branchId_fingerprint_status_idx" ON "OperatorInsight"("companyId","branchId","fingerprint","status");

CREATE TABLE IF NOT EXISTS "AssistantInteraction" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "question" TEXT NOT NULL,
  "intent" TEXT NOT NULL,
  "response" JSONB NOT NULL,
  "sourceLinks" JSONB NOT NULL,
  "confidence" DECIMAL(65,30) NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AssistantInteraction_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AssistantInteraction_companyId_branchId_userId_createdAt_idx" ON "AssistantInteraction"("companyId","branchId","userId","createdAt");
