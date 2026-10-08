# T360-20260923 Inventory Expiry Tracking

Expand-only migration untuk menambahkan flag `Product.trackExpiry`.

- SQLite development: `sqlite-expand.sql`
- PostgreSQL production/staging: `postgresql-expand.sql`
- Tidak dijalankan otomatis oleh patch.
- Existing products tetap `trackExpiry=false`, sehingga backward-compatible.
