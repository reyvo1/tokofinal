ALTER TABLE "ApprovalRequest" ADD COLUMN "expiresAt" DATETIME;
ALTER TABLE "ApprovalRequest" ADD COLUMN "escalatedAt" DATETIME;
ALTER TABLE "ApprovalRequest" ADD COLUMN "delegatedToId" TEXT;
ALTER TABLE "ApprovalRequest" ADD COLUMN "delegatedById" TEXT;
ALTER TABLE "ApprovalRequest" ADD COLUMN "delegatedAt" DATETIME;
CREATE INDEX IF NOT EXISTS "ApprovalRequest_status_expiresAt_idx" ON "ApprovalRequest"("status", "expiresAt");
CREATE INDEX IF NOT EXISTS "ApprovalRequest_delegatedToId_status_idx" ON "ApprovalRequest"("delegatedToId", "status");
