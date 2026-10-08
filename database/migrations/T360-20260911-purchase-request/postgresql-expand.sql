CREATE TABLE IF NOT EXISTS "PurchaseRequest" (
  "id" TEXT NOT NULL,
  "number" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "warehouseId" TEXT NOT NULL,
  "supplierId" TEXT,
  "requestedById" TEXT,
  "approvedById" TEXT,
  "approvalRequestId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "neededBy" TIMESTAMP(3),
  "reason" TEXT,
  "notes" TEXT,
  "requestedAt" TIMESTAMP(3),
  "approvedAt" TIMESTAMP(3),
  "convertedAt" TIMESTAMP(3),
  "purchaseOrderId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PurchaseRequest_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PurchaseRequest_number_key" ON "PurchaseRequest"("number");
CREATE UNIQUE INDEX IF NOT EXISTS "PurchaseRequest_approvalRequestId_key" ON "PurchaseRequest"("approvalRequestId");
CREATE UNIQUE INDEX IF NOT EXISTS "PurchaseRequest_purchaseOrderId_key" ON "PurchaseRequest"("purchaseOrderId");
CREATE INDEX IF NOT EXISTS "PurchaseRequest_companyId_branchId_status_createdAt_idx" ON "PurchaseRequest"("companyId", "branchId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "PurchaseRequest_warehouseId_status_idx" ON "PurchaseRequest"("warehouseId", "status");
CREATE INDEX IF NOT EXISTS "PurchaseRequest_supplierId_status_idx" ON "PurchaseRequest"("supplierId", "status");
DO $$ BEGIN
  ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "PurchaseRequestItem" (
  "id" TEXT NOT NULL,
  "purchaseRequestId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "estimatedUnitCost" DECIMAL(65,30) NOT NULL,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PurchaseRequestItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "PurchaseRequestItem_purchaseRequestId_idx" ON "PurchaseRequestItem"("purchaseRequestId");
CREATE INDEX IF NOT EXISTS "PurchaseRequestItem_productId_idx" ON "PurchaseRequestItem"("productId");
DO $$ BEGIN
  ALTER TABLE "PurchaseRequestItem" ADD CONSTRAINT "PurchaseRequestItem_purchaseRequestId_fkey" FOREIGN KEY ("purchaseRequestId") REFERENCES "PurchaseRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "PurchaseRequestItem" ADD CONSTRAINT "PurchaseRequestItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
