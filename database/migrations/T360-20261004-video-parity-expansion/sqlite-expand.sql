ALTER TABLE "Product" ADD COLUMN "retailCeilingPrice" DECIMAL;

CREATE TABLE "ProductionRecipe" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "companyId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "outputProductId" TEXT NOT NULL,
  "outputQtyPerBatch" INTEGER NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "notes" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ProductionRecipe_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProductionRecipe_outputProductId_fkey" FOREIGN KEY ("outputProductId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ProductionRecipe_companyId_code_version_key" ON "ProductionRecipe"("companyId", "code", "version");
CREATE INDEX "ProductionRecipe_companyId_isActive_name_idx" ON "ProductionRecipe"("companyId", "isActive", "name");
CREATE INDEX "ProductionRecipe_outputProductId_idx" ON "ProductionRecipe"("outputProductId");

CREATE TABLE "ProductionRecipeItem" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "recipeId" TEXT NOT NULL,
  "componentProductId" TEXT NOT NULL,
  "quantityPerBatch" INTEGER NOT NULL,
  "wastePct" DECIMAL NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ProductionRecipeItem_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "ProductionRecipe" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ProductionRecipeItem_componentProductId_fkey" FOREIGN KEY ("componentProductId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ProductionRecipeItem_recipeId_componentProductId_key" ON "ProductionRecipeItem"("recipeId", "componentProductId");
CREATE INDEX "ProductionRecipeItem_componentProductId_idx" ON "ProductionRecipeItem"("componentProductId");

CREATE TABLE "ProductionOrder" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "companyId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "warehouseId" TEXT NOT NULL,
  "recipeId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "number" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "batchCount" INTEGER NOT NULL,
  "plannedOutputQty" INTEGER NOT NULL,
  "actualOutputQty" INTEGER,
  "totalCost" DECIMAL,
  "notes" TEXT,
  "releasedAt" DATETIME,
  "startedAt" DATETIME,
  "completedAt" DATETIME,
  "cancelledAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ProductionOrder_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProductionOrder_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProductionOrder_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProductionOrder_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "ProductionRecipe" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProductionOrder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ProductionOrder_number_key" ON "ProductionOrder"("number");
CREATE INDEX "ProductionOrder_companyId_branchId_status_createdAt_idx" ON "ProductionOrder"("companyId", "branchId", "status", "createdAt");
CREATE INDEX "ProductionOrder_warehouseId_status_idx" ON "ProductionOrder"("warehouseId", "status");
CREATE INDEX "ProductionOrder_recipeId_idx" ON "ProductionOrder"("recipeId");

CREATE TABLE "ProductionOrderComponent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "orderId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "plannedQty" INTEGER NOT NULL,
  "actualQty" INTEGER,
  "unitCost" DECIMAL,
  "totalCost" DECIMAL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ProductionOrderComponent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ProductionOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ProductionOrderComponent_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ProductionOrderComponent_orderId_productId_key" ON "ProductionOrderComponent"("orderId", "productId");
CREATE INDEX "ProductionOrderComponent_productId_idx" ON "ProductionOrderComponent"("productId");

CREATE TABLE "DigitalServiceProduct" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "companyId" TEXT NOT NULL,
  "integrationId" TEXT NOT NULL,
  "providerSku" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "brand" TEXT,
  "type" TEXT,
  "sellerName" TEXT,
  "kind" TEXT NOT NULL DEFAULT 'PREPAID',
  "costPrice" DECIMAL,
  "salePrice" DECIMAL NOT NULL,
  "buyerProductStatus" BOOLEAN NOT NULL DEFAULT true,
  "sellerProductStatus" BOOLEAN NOT NULL DEFAULT true,
  "unlimitedStock" BOOLEAN NOT NULL DEFAULT false,
  "stock" INTEGER,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "metadata" JSONB,
  "syncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "DigitalServiceProduct_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DigitalServiceProduct_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "IntegrationConnection" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "DigitalServiceProduct_integrationId_providerSku_key" ON "DigitalServiceProduct"("integrationId", "providerSku");
CREATE INDEX "DigitalServiceProduct_companyId_active_category_brand_idx" ON "DigitalServiceProduct"("companyId", "active", "category", "brand");

CREATE TABLE "DigitalServiceTransaction" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "companyId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "integrationId" TEXT NOT NULL,
  "requestedById" TEXT NOT NULL,
  "providerSku" TEXT NOT NULL,
  "customerNo" TEXT NOT NULL,
  "number" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'PREPAID',
  "sellingPrice" DECIMAL NOT NULL,
  "maxPrice" DECIMAL,
  "costAmount" DECIMAL,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "providerRef" TEXT,
  "providerRc" TEXT,
  "message" TEXT,
  "serialNumber" TEXT,
  "requestData" JSONB,
  "responseData" JSONB,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastCheckedAt" DATETIME,
  "completedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "DigitalServiceTransaction_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DigitalServiceTransaction_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DigitalServiceTransaction_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "IntegrationConnection" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DigitalServiceTransaction_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "DigitalServiceTransaction_number_key" ON "DigitalServiceTransaction"("number");
CREATE UNIQUE INDEX "DigitalServiceTransaction_companyId_idempotencyKey_key" ON "DigitalServiceTransaction"("companyId", "idempotencyKey");
CREATE INDEX "DigitalServiceTransaction_companyId_branchId_status_createdAt_idx" ON "DigitalServiceTransaction"("companyId", "branchId", "status", "createdAt");
CREATE INDEX "DigitalServiceTransaction_integrationId_providerSku_idx" ON "DigitalServiceTransaction"("integrationId", "providerSku");
