-- Expand-only local migration for storefront customer accounts.
ALTER TABLE "Order" ADD COLUMN "customerId" TEXT;
CREATE INDEX IF NOT EXISTS "Order_customerId_createdAt_idx" ON "Order"("customerId", "createdAt");

CREATE TABLE IF NOT EXISTS "CustomerAccount" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "customerId" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "failedAttempts" INTEGER NOT NULL DEFAULT 0,
  "lockedUntil" DATETIME,
  "lastLoginAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "CustomerAccount_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "CustomerAccount_customerId_key" ON "CustomerAccount"("customerId");

CREATE TABLE IF NOT EXISTS "CustomerSession" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "customerId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" DATETIME NOT NULL,
  "lastUsedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomerSession_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "CustomerSession_tokenHash_key" ON "CustomerSession"("tokenHash");
CREATE INDEX IF NOT EXISTS "CustomerSession_customerId_expiresAt_idx" ON "CustomerSession"("customerId", "expiresAt");
CREATE INDEX IF NOT EXISTS "CustomerSession_expiresAt_revokedAt_idx" ON "CustomerSession"("expiresAt", "revokedAt");
