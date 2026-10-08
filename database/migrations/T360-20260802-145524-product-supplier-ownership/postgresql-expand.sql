-- T360-20260802-145524 — PostgreSQL staging/production expand-only migration.
-- Wajib backup/restore point, review DBA, dan uji staging sebelum production.
-- Jangan memakai prisma db push pada production.

BEGIN;

ALTER TABLE "Product" ADD COLUMN "companyId" TEXT;
ALTER TABLE "Supplier" ADD COLUMN "companyId" TEXT;

ALTER TABLE "Product"
  ADD CONSTRAINT "Product_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Supplier"
  ADD CONSTRAINT "Supplier_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Product_companyId_isActive_name_id_idx"
  ON "Product"("companyId", "isActive", "name", "id");
CREATE INDEX "Product_companyId_sku_idx"
  ON "Product"("companyId", "sku");
CREATE INDEX "Supplier_companyId_name_id_idx"
  ON "Supplier"("companyId", "name", "id");
CREATE INDEX "Supplier_companyId_code_idx"
  ON "Supplier"("companyId", "code");

COMMIT;
