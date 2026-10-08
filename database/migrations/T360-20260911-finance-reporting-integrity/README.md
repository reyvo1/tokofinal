# T360 Finance/Reporting Integrity — deployment note

Tahap ini **tidak mengubah struktur database**, sehingga tidak ada SQL expand/backfill baru.

Perubahan data konfigurasi yang wajib untuk database existing:

- canonical posting rule `TAX-PAYMENT` (`TAX_PAYMENT`): Dr tax payable / Cr settlement.

Setelah deploy source, jalankan canonical seed sebelum memposting transaksi `TAX_PAYMENT`. Seed bersifat upsert untuk posting rules canonical.

Lalu jalankan regression/runtime gate yang dijelaskan di `docs/FINANCE-ACCOUNTING-RECONCILIATION.md`.
