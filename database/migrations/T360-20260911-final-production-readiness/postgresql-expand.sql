DO $$ BEGIN
  ALTER TYPE "ApprovalStatus" ADD VALUE IF NOT EXISTS 'EXPIRED';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE "ApprovalRequest" ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3);
ALTER TABLE "ApprovalRequest" ADD COLUMN IF NOT EXISTS "escalatedAt" TIMESTAMP(3);
ALTER TABLE "ApprovalRequest" ADD COLUMN IF NOT EXISTS "delegatedToId" TEXT;
ALTER TABLE "ApprovalRequest" ADD COLUMN IF NOT EXISTS "delegatedById" TEXT;
ALTER TABLE "ApprovalRequest" ADD COLUMN IF NOT EXISTS "delegatedAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "ApprovalRequest_status_expiresAt_idx" ON "ApprovalRequest"("status", "expiresAt");
CREATE INDEX IF NOT EXISTS "ApprovalRequest_delegatedToId_status_idx" ON "ApprovalRequest"("delegatedToId", "status");
