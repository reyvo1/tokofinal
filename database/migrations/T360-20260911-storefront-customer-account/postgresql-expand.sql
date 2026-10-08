-- Expand-only PostgreSQL migration for storefront customer accounts.
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "customerId" TEXT;
CREATE INDEX IF NOT EXISTS "Order_customerId_createdAt_idx" ON "Order"("customerId", "createdAt");
DO $$ BEGIN
  ALTER TABLE "Order" ADD CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "CustomerAccount" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "failedAttempts" INTEGER NOT NULL DEFAULT 0,
  "lockedUntil" TIMESTAMP(3),
  "lastLoginAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CustomerAccount_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CustomerAccount_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "CustomerAccount_customerId_key" ON "CustomerAccount"("customerId");

CREATE TABLE IF NOT EXISTS "CustomerSession" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomerSession_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CustomerSession_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "CustomerSession_tokenHash_key" ON "CustomerSession"("tokenHash");
CREATE INDEX IF NOT EXISTS "CustomerSession_customerId_expiresAt_idx" ON "CustomerSession"("customerId", "expiresAt");
CREATE INDEX IF NOT EXISTS "CustomerSession_expiresAt_revokedAt_idx" ON "CustomerSession"("expiresAt", "revokedAt");
