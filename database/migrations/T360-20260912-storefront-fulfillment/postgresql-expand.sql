-- Expand-only PostgreSQL migration: customer address book + storefront fulfillment snapshot.
CREATE TABLE IF NOT EXISTS "CustomerAddress" (
  "id" TEXT NOT NULL,
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
  "latitude" DECIMAL(65,30),
  "longitude" DECIMAL(65,30),
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CustomerAddress_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CustomerAddress_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "CustomerAddress_customerId_isActive_isDefault_idx" ON "CustomerAddress"("customerId","isActive","isDefault");

ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "fulfillmentType" TEXT NOT NULL DEFAULT 'DELIVERY';
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "customerAddressId" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "shippingMethodCode" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "shippingMethodName" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "pickupWarehouseId" TEXT;
