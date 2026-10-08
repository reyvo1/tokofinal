# F11 transaction UOM expand migration

Additive transaction snapshots for PurchaseOrderItem, GoodsReceiptItem, and SaleItem. Existing rows keep factor 1 and therefore retain base-unit semantics. Apply through the normal TEST/STAGING migration workflow; this patch does not auto-run migrations.
