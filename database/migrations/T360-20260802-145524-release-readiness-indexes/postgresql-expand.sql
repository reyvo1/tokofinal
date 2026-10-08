-- T360 Stage 20 critical tenant/pagination indexes.
-- Additive and idempotent. TEST/STAGING rehearsal first; production requires change approval.

CREATE INDEX IF NOT EXISTS "Product_companyId_isActive_name_id_idx"
  ON "Product" ("companyId", "isActive", "name", "id");

CREATE INDEX IF NOT EXISTS "Warehouse_branchId_idx"
  ON "Warehouse" ("branchId");

CREATE INDEX IF NOT EXISTS "Inventory_warehouseId_updatedAt_id_idx"
  ON "Inventory" ("warehouseId", "updatedAt", "id");

CREATE INDEX IF NOT EXISTS "AccountingEvent_companyId_branchId_createdAt_id_idx"
  ON "AccountingEvent" ("companyId", "branchId", "createdAt", "id");

CREATE INDEX IF NOT EXISTS "PayrollRun_companyId_branchId_createdAt_idx"
  ON "PayrollRun" ("companyId", "branchId", "createdAt");
