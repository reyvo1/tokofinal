CREATE TABLE IF NOT EXISTS "ProductUnit" (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "variantId" TEXT,
  "scopeKey" TEXT NOT NULL DEFAULT 'BASE',
  "unitCode" TEXT NOT NULL,
  "quantityFactor" INTEGER NOT NULL,
  "isDefaultSale" BOOLEAN NOT NULL DEFAULT false,
  "isDefaultPurchase" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductUnit_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ProductUnit_productId_scopeKey_unitCode_key" ON "ProductUnit"("productId","scopeKey","unitCode");
CREATE INDEX IF NOT EXISTS "ProductUnit_productId_variantId_isActive_unitCode_idx" ON "ProductUnit"("productId","variantId","isActive","unitCode");
DO $$ BEGIN ALTER TABLE "ProductUnit" ADD CONSTRAINT "ProductUnit_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "ProductUnit" ADD CONSTRAINT "ProductUnit_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE "ProductBarcode" ADD COLUMN IF NOT EXISTS "productUnitId" TEXT;
ALTER TABLE "ProductPrice" ADD COLUMN IF NOT EXISTS "productUnitId" TEXT;
DO $$ BEGIN ALTER TABLE "ProductBarcode" ADD CONSTRAINT "ProductBarcode_productUnitId_fkey" FOREIGN KEY ("productUnitId") REFERENCES "ProductUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "ProductPrice" ADD CONSTRAINT "ProductPrice_productUnitId_fkey" FOREIGN KEY ("productUnitId") REFERENCES "ProductUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "ProductBarcode_productUnitId_idx" ON "ProductBarcode"("productUnitId");
CREATE INDEX IF NOT EXISTS "ProductPrice_productUnitId_idx" ON "ProductPrice"("productUnitId");
