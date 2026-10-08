# T360-20261004 video parity expansion

Expand-only schema for the 2026-10-04 video-benchmark enhancement wave.

Adds:
- optional `Product.retailCeilingPrice` (HET per base unit),
- production recipe/BOM and production-order lifecycle tables,
- production inventory movement enum values,
- provider-neutral digital-service catalog/transaction tables,
- PostgreSQL `PPOB` integration type and digital-service/production enums.

The migration is registered in `config/expand-migration-order.json` for both SQLite rehearsal and PostgreSQL release flow. It contains no DROP/rename/destructive data conversion.

Inventory costing is intentionally **not** migrated to FIFO in this wave. Canonical `MOVING_AVERAGE` remains authoritative until receipt/sale/production/return/transfer/reversal cost layers can be delivered and verified end-to-end.
