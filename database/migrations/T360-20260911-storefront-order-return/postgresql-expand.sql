CREATE TABLE IF NOT EXISTS "OrderReturn" (
  "id" TEXT NOT NULL,
  "number" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "warehouseId" TEXT NOT NULL,
  "customerId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'REQUESTED',
  "reason" TEXT,
  "refundMethod" TEXT,
  "refundAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
  "inspectionId" TEXT,
  "accountingEventId" TEXT,
  "approvedById" TEXT,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "approvedAt" TIMESTAMP(3),
  "postedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OrderReturn_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "OrderReturn_number_key" ON "OrderReturn"("number");
CREATE UNIQUE INDEX IF NOT EXISTS "OrderReturn_accountingEventId_key" ON "OrderReturn"("accountingEventId");
CREATE INDEX IF NOT EXISTS "OrderReturn_companyId_branchId_status_createdAt_idx" ON "OrderReturn"("companyId","branchId","status","createdAt");
CREATE INDEX IF NOT EXISTS "OrderReturn_orderId_createdAt_idx" ON "OrderReturn"("orderId","createdAt");
CREATE INDEX IF NOT EXISTS "OrderReturn_customerId_createdAt_idx" ON "OrderReturn"("customerId","createdAt");
DO $$ BEGIN ALTER TABLE "OrderReturn" ADD CONSTRAINT "OrderReturn_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "OrderReturn" ADD CONSTRAINT "OrderReturn_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "OrderReturn" ADD CONSTRAINT "OrderReturn_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "OrderReturn" ADD CONSTRAINT "OrderReturn_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "OrderReturn" ADD CONSTRAINT "OrderReturn_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "OrderReturnItem" (
  "id" TEXT NOT NULL,
  "orderReturnId" TEXT NOT NULL,
  "orderItemId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "condition" TEXT NOT NULL DEFAULT 'GOOD',
  "restock" BOOLEAN NOT NULL DEFAULT true,
  "unitAmount" DECIMAL(65,30) NOT NULL,
  "unitCost" DECIMAL(65,30) NOT NULL,
  "netAmount" DECIMAL(65,30) NOT NULL,
  "taxAmount" DECIMAL(65,30) NOT NULL,
  "grossAmount" DECIMAL(65,30) NOT NULL,
  "taxCodeId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderReturnItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "OrderReturnItem_orderReturnId_idx" ON "OrderReturnItem"("orderReturnId");
CREATE INDEX IF NOT EXISTS "OrderReturnItem_orderItemId_idx" ON "OrderReturnItem"("orderItemId");
CREATE INDEX IF NOT EXISTS "OrderReturnItem_productId_idx" ON "OrderReturnItem"("productId");
DO $$ BEGIN ALTER TABLE "OrderReturnItem" ADD CONSTRAINT "OrderReturnItem_orderReturnId_fkey" FOREIGN KEY ("orderReturnId") REFERENCES "OrderReturn"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "OrderReturnItem" ADD CONSTRAINT "OrderReturnItem_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "OrderReturnItem" ADD CONSTRAINT "OrderReturnItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
