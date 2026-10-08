-- P2A expand-only: persist immutable transaction UOM lineage for online orders
-- and all return families. Existing quantity columns remain canonical base-unit
-- quantities; unitQuantity + quantityFactor preserve the customer/operator UOM.
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "variantId" TEXT;
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "productUnitId" TEXT;
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "unitCode" TEXT;
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "unitQuantity" INTEGER;
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "quantityFactor" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "sourceBarcode" TEXT;

ALTER TABLE "OrderReturnItem" ADD COLUMN IF NOT EXISTS "variantId" TEXT;
ALTER TABLE "OrderReturnItem" ADD COLUMN IF NOT EXISTS "productUnitId" TEXT;
ALTER TABLE "OrderReturnItem" ADD COLUMN IF NOT EXISTS "unitCode" TEXT;
ALTER TABLE "OrderReturnItem" ADD COLUMN IF NOT EXISTS "unitQuantity" INTEGER;
ALTER TABLE "OrderReturnItem" ADD COLUMN IF NOT EXISTS "quantityFactor" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "OrderReturnItem" ADD COLUMN IF NOT EXISTS "sourceBarcode" TEXT;

ALTER TABLE "SaleReturnItem" ADD COLUMN IF NOT EXISTS "variantId" TEXT;
ALTER TABLE "SaleReturnItem" ADD COLUMN IF NOT EXISTS "productUnitId" TEXT;
ALTER TABLE "SaleReturnItem" ADD COLUMN IF NOT EXISTS "unitCode" TEXT;
ALTER TABLE "SaleReturnItem" ADD COLUMN IF NOT EXISTS "unitQuantity" INTEGER;
ALTER TABLE "SaleReturnItem" ADD COLUMN IF NOT EXISTS "quantityFactor" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "SaleReturnItem" ADD COLUMN IF NOT EXISTS "sourceBarcode" TEXT;

ALTER TABLE "PurchaseReturnItem" ADD COLUMN IF NOT EXISTS "variantId" TEXT;
ALTER TABLE "PurchaseReturnItem" ADD COLUMN IF NOT EXISTS "productUnitId" TEXT;
ALTER TABLE "PurchaseReturnItem" ADD COLUMN IF NOT EXISTS "unitCode" TEXT;
ALTER TABLE "PurchaseReturnItem" ADD COLUMN IF NOT EXISTS "unitQuantity" INTEGER;
ALTER TABLE "PurchaseReturnItem" ADD COLUMN IF NOT EXISTS "quantityFactor" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "PurchaseReturnItem" ADD COLUMN IF NOT EXISTS "sourceBarcode" TEXT;
