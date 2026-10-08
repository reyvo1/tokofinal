-- Backfill terpisah setelah postgresql-expand.sql.
-- Hanya record dengan tepat satu kandidat company yang diisi otomatis.
-- Jalankan dalam maintenance window setelah dry-run query dan backup/restore point.

BEGIN;

WITH product_candidates("productId", "companyId") AS (
  SELECT i."productId", b."companyId"
  FROM "Inventory" i
  JOIN "Warehouse" w ON w."id" = i."warehouseId"
  JOIN "Branch" b ON b."id" = w."branchId"
  UNION
  SELECT poi."productId", b."companyId"
  FROM "PurchaseOrderItem" poi
  JOIN "PurchaseOrder" po ON po."id" = poi."purchaseOrderId"
  JOIN "Warehouse" w ON w."id" = po."warehouseId"
  JOIN "Branch" b ON b."id" = w."branchId"
  UNION
  SELECT gri."productId", b."companyId"
  FROM "GoodsReceiptItem" gri
  JOIN "GoodsReceipt" gr ON gr."id" = gri."goodsReceiptId"
  JOIN "Warehouse" w ON w."id" = gr."warehouseId"
  JOIN "Branch" b ON b."id" = w."branchId"
  UNION
  SELECT si."productId", b."companyId"
  FROM "SaleItem" si
  JOIN "Sale" s ON s."id" = si."saleId"
  JOIN "Branch" b ON b."id" = s."branchId"
  UNION
  SELECT oi."productId", b."companyId"
  FROM "OrderItem" oi
  JOIN "Order" o ON o."id" = oi."orderId"
  JOIN "Branch" b ON b."id" = o."branchId"
),
resolved_products AS (
  SELECT "productId", MIN("companyId") AS "companyId"
  FROM product_candidates
  GROUP BY "productId"
  HAVING COUNT(DISTINCT "companyId") = 1
)
UPDATE "Product" p
SET "companyId" = rp."companyId"
FROM resolved_products rp
WHERE p."id" = rp."productId" AND p."companyId" IS NULL;

WITH supplier_candidates("supplierId", "companyId") AS (
  SELECT po."supplierId", b."companyId"
  FROM "PurchaseOrder" po
  JOIN "Warehouse" w ON w."id" = po."warehouseId"
  JOIN "Branch" b ON b."id" = w."branchId"
  UNION
  SELECT gr."supplierId", b."companyId"
  FROM "GoodsReceipt" gr
  JOIN "Warehouse" w ON w."id" = gr."warehouseId"
  JOIN "Branch" b ON b."id" = w."branchId"
  UNION
  SELECT pr."supplierId", b."companyId"
  FROM "PurchaseReturn" pr
  JOIN "Warehouse" w ON w."id" = pr."warehouseId"
  JOIN "Branch" b ON b."id" = w."branchId"
),
resolved_suppliers AS (
  SELECT "supplierId", MIN("companyId") AS "companyId"
  FROM supplier_candidates
  GROUP BY "supplierId"
  HAVING COUNT(DISTINCT "companyId") = 1
)
UPDATE "Supplier" s
SET "companyId" = rs."companyId"
FROM resolved_suppliers rs
WHERE s."id" = rs."supplierId" AND s."companyId" IS NULL;

COMMIT;

-- Evidence wajib setelah backfill.
SELECT 'unresolved_product' AS "issue", "id", "sku" AS "businessKey"
FROM "Product" WHERE "companyId" IS NULL
UNION ALL
SELECT 'unresolved_supplier', "id", "code"
FROM "Supplier" WHERE "companyId" IS NULL;
