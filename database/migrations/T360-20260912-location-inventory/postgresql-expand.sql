ALTER TABLE "WarehouseLocation" ADD COLUMN IF NOT EXISTS "isDefault" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "InventoryMovement" ADD COLUMN IF NOT EXISTS "locationId" TEXT;

DO $$ BEGIN
  ALTER TYPE "InventoryMovementType" ADD VALUE IF NOT EXISTS 'LOCATION_MOVE_IN';
  ALTER TYPE "InventoryMovementType" ADD VALUE IF NOT EXISTS 'LOCATION_MOVE_OUT';
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "InventoryMovement_locationId_productId_createdAt_idx"
  ON "InventoryMovement"("locationId", "productId", "createdAt");

CREATE TABLE IF NOT EXISTS "InventoryLocationBalance" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "warehouseId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 0,
  "reserved" INTEGER NOT NULL DEFAULT 0,
  "available" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "InventoryLocationBalance_locationId_productId_key"
  ON "InventoryLocationBalance"("locationId", "productId");
CREATE INDEX IF NOT EXISTS "InventoryLocationBalance_warehouseId_productId_idx"
  ON "InventoryLocationBalance"("warehouseId", "productId");
CREATE INDEX IF NOT EXISTS "InventoryLocationBalance_warehouseId_available_idx"
  ON "InventoryLocationBalance"("warehouseId", "available");

CREATE TABLE IF NOT EXISTS "InventoryReservation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "warehouseId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "InventoryReservation_sourceType_sourceId_locationId_productId_key"
  ON "InventoryReservation"("sourceType", "sourceId", "locationId", "productId");
CREATE INDEX IF NOT EXISTS "InventoryReservation_warehouseId_productId_status_idx"
  ON "InventoryReservation"("warehouseId", "productId", "status");
CREATE INDEX IF NOT EXISTS "InventoryReservation_sourceType_sourceId_status_idx"
  ON "InventoryReservation"("sourceType", "sourceId", "status");
