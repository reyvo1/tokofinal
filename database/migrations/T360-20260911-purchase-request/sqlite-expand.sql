PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS "PurchaseRequest" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "number" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "warehouseId" TEXT NOT NULL,
  "supplierId" TEXT,
  "requestedById" TEXT,
  "approvedById" TEXT,
  "approvalRequestId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "neededBy" DATETIME,
  "reason" TEXT,
  "notes" TEXT,
  "requestedAt" DATETIME,
  "approvedAt" DATETIME,
  "convertedAt" DATETIME,
  "purchaseOrderId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "PurchaseRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PurchaseRequest_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PurchaseRequest_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PurchaseRequest_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "PurchaseRequest_number_key" ON "PurchaseRequest"("number");
CREATE UNIQUE INDEX IF NOT EXISTS "PurchaseRequest_approvalRequestId_key" ON "PurchaseRequest"("approvalRequestId");
CREATE UNIQUE INDEX IF NOT EXISTS "PurchaseRequest_purchaseOrderId_key" ON "PurchaseRequest"("purchaseOrderId");
CREATE INDEX IF NOT EXISTS "PurchaseRequest_companyId_branchId_status_createdAt_idx" ON "PurchaseRequest"("companyId", "branchId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "PurchaseRequest_warehouseId_status_idx" ON "PurchaseRequest"("warehouseId", "status");
CREATE INDEX IF NOT EXISTS "PurchaseRequest_supplierId_status_idx" ON "PurchaseRequest"("supplierId", "status");

CREATE TABLE IF NOT EXISTS "PurchaseRequestItem" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "purchaseRequestId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "estimatedUnitCost" DECIMAL NOT NULL,
  "notes" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PurchaseRequestItem_purchaseRequestId_fkey" FOREIGN KEY ("purchaseRequestId") REFERENCES "PurchaseRequest" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PurchaseRequestItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "PurchaseRequestItem_purchaseRequestId_idx" ON "PurchaseRequestItem"("purchaseRequestId");
CREATE INDEX IF NOT EXISTS "PurchaseRequestItem_productId_idx" ON "PurchaseRequestItem"("productId");
