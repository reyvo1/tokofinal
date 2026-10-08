-- P2A expand-only SQLite parity. Apply once to a pre-P2A schema.
ALTER TABLE "OrderItem" ADD COLUMN "variantId" TEXT;
ALTER TABLE "OrderItem" ADD COLUMN "productUnitId" TEXT;
ALTER TABLE "OrderItem" ADD COLUMN "unitCode" TEXT;
ALTER TABLE "OrderItem" ADD COLUMN "unitQuantity" INTEGER;
ALTER TABLE "OrderItem" ADD COLUMN "quantityFactor" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "OrderItem" ADD COLUMN "sourceBarcode" TEXT;

ALTER TABLE "OrderReturnItem" ADD COLUMN "variantId" TEXT;
ALTER TABLE "OrderReturnItem" ADD COLUMN "productUnitId" TEXT;
ALTER TABLE "OrderReturnItem" ADD COLUMN "unitCode" TEXT;
ALTER TABLE "OrderReturnItem" ADD COLUMN "unitQuantity" INTEGER;
ALTER TABLE "OrderReturnItem" ADD COLUMN "quantityFactor" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "OrderReturnItem" ADD COLUMN "sourceBarcode" TEXT;

ALTER TABLE "SaleReturnItem" ADD COLUMN "variantId" TEXT;
ALTER TABLE "SaleReturnItem" ADD COLUMN "productUnitId" TEXT;
ALTER TABLE "SaleReturnItem" ADD COLUMN "unitCode" TEXT;
ALTER TABLE "SaleReturnItem" ADD COLUMN "unitQuantity" INTEGER;
ALTER TABLE "SaleReturnItem" ADD COLUMN "quantityFactor" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "SaleReturnItem" ADD COLUMN "sourceBarcode" TEXT;

ALTER TABLE "PurchaseReturnItem" ADD COLUMN "variantId" TEXT;
ALTER TABLE "PurchaseReturnItem" ADD COLUMN "productUnitId" TEXT;
ALTER TABLE "PurchaseReturnItem" ADD COLUMN "unitCode" TEXT;
ALTER TABLE "PurchaseReturnItem" ADD COLUMN "unitQuantity" INTEGER;
ALTER TABLE "PurchaseReturnItem" ADD COLUMN "quantityFactor" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "PurchaseReturnItem" ADD COLUMN "sourceBarcode" TEXT;
