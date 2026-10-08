ALTER TABLE "PurchaseOrderItem" ADD COLUMN "variantId" TEXT;
ALTER TABLE "PurchaseOrderItem" ADD COLUMN "productUnitId" TEXT;
ALTER TABLE "PurchaseOrderItem" ADD COLUMN "unitCode" TEXT;
ALTER TABLE "PurchaseOrderItem" ADD COLUMN "unitQuantity" INTEGER;
ALTER TABLE "PurchaseOrderItem" ADD COLUMN "quantityFactor" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "PurchaseOrderItem" ADD COLUMN "purchaseUnitCost" DECIMAL;

ALTER TABLE "GoodsReceiptItem" ADD COLUMN "variantId" TEXT;
ALTER TABLE "GoodsReceiptItem" ADD COLUMN "productUnitId" TEXT;
ALTER TABLE "GoodsReceiptItem" ADD COLUMN "unitCode" TEXT;
ALTER TABLE "GoodsReceiptItem" ADD COLUMN "unitQuantity" INTEGER;
ALTER TABLE "GoodsReceiptItem" ADD COLUMN "damagedUnitQuantity" INTEGER;
ALTER TABLE "GoodsReceiptItem" ADD COLUMN "quantityFactor" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "SaleItem" ADD COLUMN "variantId" TEXT;
ALTER TABLE "SaleItem" ADD COLUMN "productUnitId" TEXT;
