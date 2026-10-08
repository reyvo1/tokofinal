ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "emailVerifiedAt" TIMESTAMP(3);
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "phoneVerifiedAt" TIMESTAMP(3);
CREATE TABLE IF NOT EXISTS "CustomerVerificationToken" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "targetHash" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomerVerificationToken_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CustomerVerificationToken_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "CustomerVerificationToken_customerId_type_createdAt_idx" ON "CustomerVerificationToken"("customerId", "type", "createdAt");
CREATE INDEX IF NOT EXISTS "CustomerVerificationToken_expiresAt_consumedAt_idx" ON "CustomerVerificationToken"("expiresAt", "consumedAt");
