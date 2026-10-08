ALTER TABLE "WarehouseLocation" ADD COLUMN "isDefault" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "InventoryMovement" ADD COLUMN "locationId" TEXT;

CREATE INDEX "InventoryMovement_locationId_productId_createdAt_idx"
  ON "InventoryMovement"("locationId", "productId", "createdAt");

CREATE TABLE "InventoryLocationBalance" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "warehouseId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 0,
  "reserved" INTEGER NOT NULL DEFAULT 0,
  "available" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "InventoryLocationBalance_locationId_productId_key"
  ON "InventoryLocationBalance"("locationId", "productId");
CREATE INDEX "InventoryLocationBalance_warehouseId_productId_idx"
  ON "InventoryLocationBalance"("warehouseId", "productId");
CREATE INDEX "InventoryLocationBalance_warehouseId_available_idx"
  ON "InventoryLocationBalance"("warehouseId", "available");

CREATE TABLE "InventoryReservation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "warehouseId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "InventoryReservation_sourceType_sourceId_locationId_productId_key"
  ON "InventoryReservation"("sourceType", "sourceId", "locationId", "productId");
CREATE INDEX "InventoryReservation_warehouseId_productId_status_idx"
  ON "InventoryReservation"("warehouseId", "productId", "status");
CREATE INDEX "InventoryReservation_sourceType_sourceId_status_idx"
  ON "InventoryReservation"("sourceType", "sourceId", "status");
