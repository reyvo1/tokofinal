CREATE TABLE IF NOT EXISTS "ProductFavorite" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductFavorite_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ProductFavorite_customerId_productId_key" ON "ProductFavorite"("customerId","productId");
CREATE INDEX IF NOT EXISTS "ProductFavorite_productId_createdAt_idx" ON "ProductFavorite"("productId","createdAt");
DO $$ BEGIN ALTER TABLE "ProductFavorite" ADD CONSTRAINT "ProductFavorite_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "ProductFavorite" ADD CONSTRAINT "ProductFavorite_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE TABLE IF NOT EXISTS "ProductReview" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "orderId" TEXT,
  "rating" INTEGER NOT NULL,
  "title" TEXT,
  "body" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PUBLISHED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductReview_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ProductReview_customerId_productId_key" ON "ProductReview"("customerId","productId");
CREATE INDEX IF NOT EXISTS "ProductReview_productId_status_createdAt_idx" ON "ProductReview"("productId","status","createdAt");
CREATE INDEX IF NOT EXISTS "ProductReview_customerId_createdAt_idx" ON "ProductReview"("customerId","createdAt");
DO $$ BEGIN ALTER TABLE "ProductReview" ADD CONSTRAINT "ProductReview_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "ProductReview" ADD CONSTRAINT "ProductReview_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
