ALTER TABLE "DeviceCredential" ADD COLUMN "encryptedSecret" TEXT;
CREATE TABLE "DeviceAuthNonce" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "credentialId" TEXT NOT NULL,
  "nonce" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "requestAt" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "DeviceAuthNonce_credentialId_nonce_key" ON "DeviceAuthNonce"("credentialId", "nonce");
CREATE INDEX "DeviceAuthNonce_credentialId_createdAt_idx" ON "DeviceAuthNonce"("credentialId", "createdAt");
CREATE INDEX "DeviceAuthNonce_createdAt_idx" ON "DeviceAuthNonce"("createdAt");
