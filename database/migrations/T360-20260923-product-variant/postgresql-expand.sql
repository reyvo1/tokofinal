CREATE TABLE IF NOT EXISTS "ProductVariant" (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "sku" TEXT,
  "name" TEXT NOT NULL,
  "attributes" JSONB,
  "costPrice" DECIMAL(65,30),
  "salePrice" DECIMAL(65,30),
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ProductVariant_productId_code_key" ON "ProductVariant"("productId", "code");
CREATE UNIQUE INDEX IF NOT EXISTS "ProductVariant_sku_key" ON "ProductVariant"("sku");
CREATE INDEX IF NOT EXISTS "ProductVariant_productId_isActive_name_idx" ON "ProductVariant"("productId", "isActive", "name");
ALTER TABLE "ProductVariant" DROP CONSTRAINT IF EXISTS "ProductVariant_productId_fkey";
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductBarcode" ADD COLUMN IF NOT EXISTS "variantId" TEXT;
CREATE INDEX IF NOT EXISTS "ProductBarcode_productId_variantId_isPrimary_idx" ON "ProductBarcode"("productId", "variantId", "isPrimary");
DO $$ BEGIN
  ALTER TABLE "ProductBarcode" ADD CONSTRAINT "ProductBarcode_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
ALTER TABLE "ProductPrice" ADD COLUMN IF NOT EXISTS "variantId" TEXT;
CREATE INDEX IF NOT EXISTS "ProductPrice_productId_variantId_branchId_segmentCode_isActive_minQty_idx" ON "ProductPrice"("productId", "variantId", "branchId", "segmentCode", "isActive", "minQty");
DO $$ BEGIN
  ALTER TABLE "ProductPrice" ADD CONSTRAINT "ProductPrice_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
