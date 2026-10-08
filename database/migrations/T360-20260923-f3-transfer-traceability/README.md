# F3 transfer traceability expand migration

Expand-only migration for stock-transfer serial manifests and explicit serial IN_TRANSIT state.

- SQLite: adds nullable `StockTransferItem.serialNumbers` JSON column. Prisma enum values are application-level for SQLite.
- PostgreSQL: adds `IN_TRANSIT` to `SerialStatus` and nullable JSONB manifest column.
- No backfill is required: existing transfers keep `serialNumbers = NULL` and retain legacy behavior.
- Do not auto-run on production. Apply through the normal TEST/STAGING migration gate.
