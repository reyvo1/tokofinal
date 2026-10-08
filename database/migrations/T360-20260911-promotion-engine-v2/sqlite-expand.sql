ALTER TABLE "PromoRule" ADD COLUMN "channel" TEXT NOT NULL DEFAULT 'ALL';
ALTER TABLE "PromoRule" ADD COLUMN "productIds" JSONB;
ALTER TABLE "PromoRule" ADD COLUMN "minQuantity" INTEGER;
ALTER TABLE "PromoRule" ADD COLUMN "buyQuantity" INTEGER;
ALTER TABLE "PromoRule" ADD COLUMN "getQuantity" INTEGER;
ALTER TABLE "PromoRule" ADD COLUMN "usageLimit" INTEGER;
ALTER TABLE "PromoRule" ADD COLUMN "perCustomerLimit" INTEGER;

CREATE TABLE "PromoRedemption" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "companyId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "promoRuleId" TEXT NOT NULL,
  "customerId" TEXT,
  "referenceType" TEXT NOT NULL,
  "referenceId" TEXT NOT NULL,
  "discount" DECIMAL NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "PromoRedemption_promoRuleId_referenceType_referenceId_key" ON "PromoRedemption"("promoRuleId", "referenceType", "referenceId");
CREATE INDEX "PromoRedemption_promoRuleId_customerId_createdAt_idx" ON "PromoRedemption"("promoRuleId", "customerId", "createdAt");
CREATE INDEX "PromoRedemption_companyId_branchId_createdAt_idx" ON "PromoRedemption"("companyId", "branchId", "createdAt");
