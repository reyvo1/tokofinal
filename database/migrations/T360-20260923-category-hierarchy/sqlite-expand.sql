ALTER TABLE "Category" ADD COLUMN "parentId" TEXT;
ALTER TABLE "Category" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Category" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;

DROP INDEX IF EXISTS "Category_name_key";
DROP INDEX IF EXISTS "Category_slug_key";
CREATE UNIQUE INDEX IF NOT EXISTS "Category_companyId_slug_key"
  ON "Category"("companyId", "slug");
CREATE INDEX IF NOT EXISTS "Category_companyId_parentId_isActive_sortOrder_name_idx"
  ON "Category"("companyId", "parentId", "isActive", "sortOrder", "name");
