ALTER TABLE "AuthSession" ADD COLUMN IF NOT EXISTS "refreshTokenHash" TEXT;
ALTER TABLE "AuthSession" ADD COLUMN IF NOT EXISTS "lastRotatedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX IF NOT EXISTS "AuthSession_refreshTokenHash_key" ON "AuthSession"("refreshTokenHash");
