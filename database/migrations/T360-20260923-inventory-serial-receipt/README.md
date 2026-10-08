# T360-20260923 Inventory serial receipt

Expand-only migration for serial-tracked inbound receiving.

- Adds nullable `GoodsReceiptItem.serialNumbers` JSON.
- Existing receipts remain valid because the new column is nullable.
- New application code requires exact accepted serial count only when `Product.trackSerial=true`.
- Migration is intentionally not auto-applied by the patch package.
