-- Auth refresh-token rotation. SQLite deployments should apply through Prisma db push/migrate tooling.
ALTER TABLE "AuthSession" ADD COLUMN "refreshTokenHash" TEXT;
ALTER TABLE "AuthSession" ADD COLUMN "lastRotatedAt" DATETIME;
CREATE UNIQUE INDEX "AuthSession_refreshTokenHash_key" ON "AuthSession"("refreshTokenHash");
