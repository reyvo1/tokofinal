-- T360-20260802-145524 — SQLite local/test expand-only migration.
-- Jalankan satu kali pada salinan database lokal/staging SQLite setelah backup.
-- Jangan gunakan file ini pada PostgreSQL.

PRAGMA foreign_keys = ON;
BEGIN IMMEDIATE;

ALTER TABLE "Product"
  ADD COLUMN "companyId" TEXT REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Supplier"
  ADD COLUMN "companyId" TEXT REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Product_companyId_isActive_name_id_idx"
  ON "Product"("companyId", "isActive", "name", "id");
CREATE INDEX "Product_companyId_sku_idx"
  ON "Product"("companyId", "sku");
CREATE INDEX "Supplier_companyId_name_id_idx"
  ON "Supplier"("companyId", "name", "id");
CREATE INDEX "Supplier_companyId_code_idx"
  ON "Supplier"("companyId", "code");

COMMIT;
