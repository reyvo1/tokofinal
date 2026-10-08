-- Reconciliation gate PostgreSQL setelah expand dan backfill pada TEST/STAGING.
-- Gate release hanya lulus bila query issue dan foreign-key orphan menghasilkan nol baris.

WITH product_candidates("productId", "companyId") AS (
  SELECT i."productId", b."companyId" FROM "Inventory" i
  JOIN "Warehouse" w ON w."id" = i."warehouseId"
  JOIN "Branch" b ON b."id" = w."branchId"
  UNION SELECT poi."productId", b."companyId" FROM "PurchaseOrderItem" poi
  JOIN "PurchaseOrder" po ON po."id" = poi."purchaseOrderId"
  JOIN "Warehouse" w ON w."id" = po."warehouseId"
  JOIN "Branch" b ON b."id" = w."branchId"
  UNION SELECT gri."productId", b."companyId" FROM "GoodsReceiptItem" gri
  JOIN "GoodsReceipt" gr ON gr."id" = gri."goodsReceiptId"
  JOIN "Warehouse" w ON w."id" = gr."warehouseId"
  JOIN "Branch" b ON b."id" = w."branchId"
  UNION SELECT si."productId", b."companyId" FROM "SaleItem" si
  JOIN "Sale" s ON s."id" = si."saleId"
  JOIN "Branch" b ON b."id" = s."branchId"
  UNION SELECT oi."productId", b."companyId" FROM "OrderItem" oi
  JOIN "Order" o ON o."id" = oi."orderId"
  JOIN "Branch" b ON b."id" = o."branchId"
)
SELECT 'product_unresolved' AS "issue", p."id", p."sku" AS "businessKey", NULL::bigint AS "candidateCount"
FROM "Product" p WHERE p."companyId" IS NULL
UNION ALL
SELECT 'product_multi_company', p."id", p."sku", COUNT(DISTINCT pc."companyId")
FROM "Product" p JOIN product_candidates pc ON pc."productId" = p."id"
GROUP BY p."id", p."sku" HAVING COUNT(DISTINCT pc."companyId") > 1
UNION ALL
SELECT 'product_mismatch', p."id", p."sku", COUNT(DISTINCT pc."companyId")
FROM "Product" p JOIN product_candidates pc ON pc."productId" = p."id"
WHERE p."companyId" IS NOT NULL AND p."companyId" <> pc."companyId"
GROUP BY p."id", p."sku";

WITH supplier_candidates("supplierId", "companyId") AS (
  SELECT po."supplierId", b."companyId" FROM "PurchaseOrder" po
  JOIN "Warehouse" w ON w."id" = po."warehouseId"
  JOIN "Branch" b ON b."id" = w."branchId"
  UNION SELECT gr."supplierId", b."companyId" FROM "GoodsReceipt" gr
  JOIN "Warehouse" w ON w."id" = gr."warehouseId"
  JOIN "Branch" b ON b."id" = w."branchId"
  UNION SELECT pr."supplierId", b."companyId" FROM "PurchaseReturn" pr
  JOIN "Warehouse" w ON w."id" = pr."warehouseId"
  JOIN "Branch" b ON b."id" = w."branchId"
)
SELECT 'supplier_unresolved' AS "issue", s."id", s."code" AS "businessKey", NULL::bigint AS "candidateCount"
FROM "Supplier" s WHERE s."companyId" IS NULL
UNION ALL
SELECT 'supplier_multi_company', s."id", s."code", COUNT(DISTINCT sc."companyId")
FROM "Supplier" s JOIN supplier_candidates sc ON sc."supplierId" = s."id"
GROUP BY s."id", s."code" HAVING COUNT(DISTINCT sc."companyId") > 1
UNION ALL
SELECT 'supplier_mismatch', s."id", s."code", COUNT(DISTINCT sc."companyId")
FROM "Supplier" s JOIN supplier_candidates sc ON sc."supplierId" = s."id"
WHERE s."companyId" IS NOT NULL AND s."companyId" <> sc."companyId"
GROUP BY s."id", s."code";

SELECT 'product_orphan_company' AS "issue", p."id", p."sku" AS "businessKey"
FROM "Product" p LEFT JOIN "Company" c ON c."id" = p."companyId"
WHERE p."companyId" IS NOT NULL AND c."id" IS NULL
UNION ALL
SELECT 'supplier_orphan_company', s."id", s."code"
FROM "Supplier" s LEFT JOIN "Company" c ON c."id" = s."companyId"
WHERE s."companyId" IS NOT NULL AND c."id" IS NULL;

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = current_schema()
  AND indexname IN (
    'Product_companyId_isActive_name_id_idx',
    'Product_companyId_sku_idx',
    'Supplier_companyId_name_id_idx',
    'Supplier_companyId_code_idx'
  )
ORDER BY indexname;
