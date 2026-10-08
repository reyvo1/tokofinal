ALTER TABLE "Customer" ADD COLUMN "emailVerifiedAt" DATETIME;
ALTER TABLE "Customer" ADD COLUMN "phoneVerifiedAt" DATETIME;
CREATE TABLE "CustomerVerificationToken" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "customerId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "targetHash" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "expiresAt" DATETIME NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "consumedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomerVerificationToken_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "CustomerVerificationToken_customerId_type_createdAt_idx" ON "CustomerVerificationToken"("customerId", "type", "createdAt");
CREATE INDEX "CustomerVerificationToken_expiresAt_consumedAt_idx" ON "CustomerVerificationToken"("expiresAt", "consumedAt");
