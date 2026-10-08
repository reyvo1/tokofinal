ALTER TABLE "AuthSession" ADD COLUMN "activeBranchId" TEXT;
CREATE INDEX IF NOT EXISTS "AuthSession_activeBranchId_revokedAt_expiresAt_idx"
ON "AuthSession"("activeBranchId","revokedAt","expiresAt");
