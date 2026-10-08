-- W6 edge/cloud sync expand migration for existing SQLite databases.
ALTER TABLE "OfflineTransaction" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "OfflineTransaction" ADD COLUMN "nextRetryAt" DATETIME;
ALTER TABLE "OfflineTransaction" ADD COLUMN "deadLetteredAt" DATETIME;

CREATE TABLE IF NOT EXISTS "DeviceCredential" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "deviceId" TEXT NOT NULL,
  "keyId" TEXT NOT NULL,
  "secretHash" TEXT NOT NULL,
  "publicKey" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "expiresAt" DATETIME,
  "revokedAt" DATETIME,
  "createdById" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "DeviceCredential_deviceId_keyId_key" ON "DeviceCredential"("deviceId", "keyId");
CREATE INDEX IF NOT EXISTS "DeviceCredential_deviceId_status_createdAt_idx" ON "DeviceCredential"("deviceId", "status", "createdAt");

CREATE TABLE IF NOT EXISTS "SyncReceipt" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "deviceId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "since" DATETIME NOT NULL,
  "checkpoint" DATETIME NOT NULL,
  "nextCursor" TEXT,
  "eventCount" INTEGER NOT NULL DEFAULT 0,
  "eventIds" JSONB NOT NULL,
  "requestHash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ISSUED',
  "acknowledgedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "SyncReceipt_deviceId_requestHash_key" ON "SyncReceipt"("deviceId", "requestHash");
CREATE INDEX IF NOT EXISTS "SyncReceipt_deviceId_status_createdAt_idx" ON "SyncReceipt"("deviceId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "SyncReceipt_companyId_branchId_createdAt_idx" ON "SyncReceipt"("companyId", "branchId", "createdAt");
