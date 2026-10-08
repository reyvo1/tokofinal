PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS "ProductUnit" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "productId" TEXT NOT NULL,
  "variantId" TEXT,
  "scopeKey" TEXT NOT NULL DEFAULT 'BASE',
  "unitCode" TEXT NOT NULL,
  "quantityFactor" INTEGER NOT NULL,
  "isDefaultSale" BOOLEAN NOT NULL DEFAULT false,
  "isDefaultPurchase" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "metadata" JSONB,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ProductUnit_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ProductUnit_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "ProductUnit_productId_scopeKey_unitCode_key" ON "ProductUnit"("productId","scopeKey","unitCode");
CREATE INDEX IF NOT EXISTS "ProductUnit_productId_variantId_isActive_unitCode_idx" ON "ProductUnit"("productId","variantId","isActive","unitCode");
ALTER TABLE "ProductBarcode" ADD COLUMN "productUnitId" TEXT REFERENCES "ProductUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProductPrice" ADD COLUMN "productUnitId" TEXT REFERENCES "ProductUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "ProductBarcode_productUnitId_idx" ON "ProductBarcode"("productUnitId");
CREATE INDEX IF NOT EXISTS "ProductPrice_productUnitId_idx" ON "ProductPrice"("productUnitId");
