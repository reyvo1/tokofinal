PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS "ProductFavorite" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "customerId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductFavorite_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ProductFavorite_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "ProductFavorite_customerId_productId_key" ON "ProductFavorite"("customerId","productId");
CREATE INDEX IF NOT EXISTS "ProductFavorite_productId_createdAt_idx" ON "ProductFavorite"("productId","createdAt");
CREATE TABLE IF NOT EXISTS "ProductReview" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "customerId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "orderId" TEXT,
  "rating" INTEGER NOT NULL,
  "title" TEXT,
  "body" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PUBLISHED',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ProductReview_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ProductReview_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "ProductReview_customerId_productId_key" ON "ProductReview"("customerId","productId");
CREATE INDEX IF NOT EXISTS "ProductReview_productId_status_createdAt_idx" ON "ProductReview"("productId","status","createdAt");
CREATE INDEX IF NOT EXISTS "ProductReview_customerId_createdAt_idx" ON "ProductReview"("customerId","createdAt");
