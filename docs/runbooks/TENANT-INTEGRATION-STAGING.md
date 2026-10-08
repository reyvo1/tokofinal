# Tenant HTTP/DB Integration — TEST/STAGING

Tahap 19 menjalankan API hasil build pada port sementara terhadap PostgreSQL TEST/STAGING. Runner membuat dua company, branch, warehouse, user, product, tax code, accounting event, payroll run, finance transaction, dan device dengan prefix unik. Setelah pengujian selesai, seluruh fixture serta audit terkait dihapus.

Gate mencakup isolasi produk, inventory, accounting/jurnal, tax, payroll, finance/payment, user branch, token tanpa branch, public order payment access, offline-sync retry/idempotency, dan audit `TENANT_ACCESS_DENIED`.

Larangan:

- Jangan arahkan konfigurasi ke production/live.
- Jangan commit `stage19-integration.env`.
- Jangan memakai port API utama.
- Jangan melanjutkan UAT bila cleanup fixture gagal.

Evidence tersanitasi disimpan pada work item; credential, password, token, dan raw database URL tidak disimpan.
