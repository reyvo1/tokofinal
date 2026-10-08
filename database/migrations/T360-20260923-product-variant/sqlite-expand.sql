CREATE TABLE IF NOT EXISTS "ProductVariant" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "productId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "sku" TEXT,
  "name" TEXT NOT NULL,
  "attributes" JSONB,
  "costPrice" DECIMAL,
  "salePrice" DECIMAL,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "ProductVariant_productId_code_key" ON "ProductVariant"("productId", "code");
CREATE UNIQUE INDEX IF NOT EXISTS "ProductVariant_sku_key" ON "ProductVariant"("sku");
CREATE INDEX IF NOT EXISTS "ProductVariant_productId_isActive_name_idx" ON "ProductVariant"("productId", "isActive", "name");
ALTER TABLE "ProductBarcode" ADD COLUMN "variantId" TEXT;
CREATE INDEX IF NOT EXISTS "ProductBarcode_productId_variantId_isPrimary_idx" ON "ProductBarcode"("productId", "variantId", "isPrimary");
ALTER TABLE "ProductPrice" ADD COLUMN "variantId" TEXT;
CREATE INDEX IF NOT EXISTS "ProductPrice_productId_variantId_branchId_segmentCode_isActive_minQty_idx" ON "ProductPrice"("productId", "variantId", "branchId", "segmentCode", "isActive", "minQty");
