ALTER TABLE "DeviceCredential" ADD COLUMN IF NOT EXISTS "encryptedSecret" TEXT;
CREATE TABLE IF NOT EXISTS "DeviceAuthNonce" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "credentialId" TEXT NOT NULL,
  "nonce" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "requestAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "DeviceAuthNonce_credentialId_nonce_key" ON "DeviceAuthNonce"("credentialId", "nonce");
CREATE INDEX IF NOT EXISTS "DeviceAuthNonce_credentialId_createdAt_idx" ON "DeviceAuthNonce"("credentialId", "createdAt");
CREATE INDEX IF NOT EXISTS "DeviceAuthNonce_createdAt_idx" ON "DeviceAuthNonce"("createdAt");
