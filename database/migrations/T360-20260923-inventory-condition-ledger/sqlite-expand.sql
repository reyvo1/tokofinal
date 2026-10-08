CREATE TABLE IF NOT EXISTS "InventoryConditionBalance" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "warehouseId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "condition" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "InventoryConditionBalance_locationId_productId_condition_key"
  ON "InventoryConditionBalance"("locationId", "productId", "condition");
CREATE INDEX IF NOT EXISTS "InventoryConditionBalance_warehouseId_productId_condition_idx"
  ON "InventoryConditionBalance"("warehouseId", "productId", "condition");
CREATE INDEX IF NOT EXISTS "InventoryConditionBalance_warehouseId_locationId_condition_idx"
  ON "InventoryConditionBalance"("warehouseId", "locationId", "condition");

CREATE TABLE IF NOT EXISTS "InventoryConditionMovement" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "warehouseId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "fromCondition" TEXT NOT NULL,
  "toCondition" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "referenceType" TEXT,
  "referenceId" TEXT,
  "notes" TEXT,
  "createdById" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "InventoryConditionMovement_warehouseId_productId_createdAt_idx"
  ON "InventoryConditionMovement"("warehouseId", "productId", "createdAt");
CREATE INDEX IF NOT EXISTS "InventoryConditionMovement_locationId_productId_createdAt_idx"
  ON "InventoryConditionMovement"("locationId", "productId", "createdAt");
CREATE INDEX IF NOT EXISTS "InventoryConditionMovement_referenceType_referenceId_idx"
  ON "InventoryConditionMovement"("referenceType", "referenceId");
