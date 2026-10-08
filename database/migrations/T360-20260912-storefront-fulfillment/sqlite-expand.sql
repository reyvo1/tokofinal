-- Expand-only SQLite migration: customer address book + storefront fulfillment snapshot.
CREATE TABLE IF NOT EXISTS "CustomerAddress" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "customerId" TEXT NOT NULL,
  "label" TEXT NOT NULL DEFAULT 'Rumah',
  "recipientName" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "addressLine" TEXT NOT NULL,
  "district" TEXT,
  "city" TEXT,
  "province" TEXT,
  "postalCode" TEXT,
  "notes" TEXT,
  "latitude" DECIMAL,
  "longitude" DECIMAL,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "CustomerAddress_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "CustomerAddress_customerId_isActive_isDefault_idx" ON "CustomerAddress"("customerId","isActive","isDefault");

ALTER TABLE "Order" ADD COLUMN "fulfillmentType" TEXT NOT NULL DEFAULT 'DELIVERY';
ALTER TABLE "Order" ADD COLUMN "customerAddressId" TEXT;
ALTER TABLE "Order" ADD COLUMN "shippingMethodCode" TEXT;
ALTER TABLE "Order" ADD COLUMN "shippingMethodName" TEXT;
ALTER TABLE "Order" ADD COLUMN "pickupWarehouseId" TEXT;
