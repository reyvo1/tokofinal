# P2A transaction UOM lineage

Expand-only migration for the Product Completion P2A wave.

## Contract

- Existing `quantity` columns remain integer **base-unit quantities** used by inventory/serial/batch movement.
- `unitQuantity`, `quantityFactor`, `unitCode`, `productUnitId`, `variantId`, and `sourceBarcode` are immutable transaction snapshots.
- Historical fulfillment/return/refund logic must copy these snapshots from the source transaction and must not reconstruct them from current ProductUnit configuration.
- No destructive/backfill migration is required. Legacy rows are interpreted as factor `1` with base-unit fallback when nullable snapshot fields are absent.

## Rollback

Application rollback is safe because the migration is additive. Columns are intentionally not dropped during rollback; later contract migration may remove them only after compatibility review.
