ALTER TABLE "PromoRule" ADD COLUMN IF NOT EXISTS "channel" TEXT NOT NULL DEFAULT 'ALL';
ALTER TABLE "PromoRule" ADD COLUMN IF NOT EXISTS "productIds" JSONB;
ALTER TABLE "PromoRule" ADD COLUMN IF NOT EXISTS "minQuantity" INTEGER;
ALTER TABLE "PromoRule" ADD COLUMN IF NOT EXISTS "buyQuantity" INTEGER;
ALTER TABLE "PromoRule" ADD COLUMN IF NOT EXISTS "getQuantity" INTEGER;
ALTER TABLE "PromoRule" ADD COLUMN IF NOT EXISTS "usageLimit" INTEGER;
ALTER TABLE "PromoRule" ADD COLUMN IF NOT EXISTS "perCustomerLimit" INTEGER;

CREATE TABLE IF NOT EXISTS "PromoRedemption" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "companyId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "promoRuleId" TEXT NOT NULL,
  "customerId" TEXT,
  "referenceType" TEXT NOT NULL,
  "referenceId" TEXT NOT NULL,
  "discount" DECIMAL(65,30) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "PromoRedemption_promoRuleId_referenceType_referenceId_key" ON "PromoRedemption"("promoRuleId", "referenceType", "referenceId");
CREATE INDEX IF NOT EXISTS "PromoRedemption_promoRuleId_customerId_createdAt_idx" ON "PromoRedemption"("promoRuleId", "customerId", "createdAt");
CREATE INDEX IF NOT EXISTS "PromoRedemption_companyId_branchId_createdAt_idx" ON "PromoRedemption"("companyId", "branchId", "createdAt");
