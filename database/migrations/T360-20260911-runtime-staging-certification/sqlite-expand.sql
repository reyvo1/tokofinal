PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS "AuthSession" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "expiresAt" DATETIME NOT NULL,
  "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" DATETIME,
  "revokeReason" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "AuthSession_userId_revokedAt_expiresAt_idx" ON "AuthSession"("userId", "revokedAt", "expiresAt");
CREATE INDEX IF NOT EXISTS "AuthSession_expiresAt_idx" ON "AuthSession"("expiresAt");

CREATE TABLE IF NOT EXISTS "RateLimitBucket" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "scope" TEXT NOT NULL,
  "keyHash" TEXT NOT NULL,
  "windowStart" DATETIME NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0,
  "blockedUntil" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "RateLimitBucket_scope_keyHash_key" ON "RateLimitBucket"("scope", "keyHash");
CREATE INDEX IF NOT EXISTS "RateLimitBucket_blockedUntil_idx" ON "RateLimitBucket"("blockedUntil");
CREATE INDEX IF NOT EXISTS "RateLimitBucket_updatedAt_idx" ON "RateLimitBucket"("updatedAt");
