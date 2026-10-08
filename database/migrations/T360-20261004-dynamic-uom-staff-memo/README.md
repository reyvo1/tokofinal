# T360-20261004 Dynamic UOM + Staff Memo

Expand-only migration for the active video-parity candidate.

- Adds `StaffMemo`, scoped by company + active branch + authenticated staff user.
- Adds an idempotency operation key and request hash so retried memo creation cannot duplicate or silently change payload.
- Removes the PostgreSQL `Product.unit` database default. The application now requires an active company `UNIT` master value explicitly for product creation/import.
- SQLite legacy databases may retain the historical column default because removing a SQLite column default requires table reconstruction. Runtime writes never rely on that default; fresh databases use the Prisma schema without a default.
- No inventory quantity, historical transaction, or posted accounting row is rewritten. Existing product base units remain unchanged unless an operator performs an allowed history-safe product edit.

Rollback is application-first: revert the application before dropping `StaffMemo`. Do not restore the old unit default as a business fallback; products must continue to carry an explicit base unit.
