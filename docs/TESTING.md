# Strategi Pengujian

1. Unit: pricing, tax, promotion, numbering, loyalty, forecast.
2. Integration: goods receipt, sale, transfer, opname, return, journal.
3. Concurrency: dua transaksi menjual/memindahkan stok yang sama.
4. Contract: payment/shipping/marketplace/notification adapters.
5. E2E: storefront checkout, POS, receiving, reporting.
6. Security: auth, role, tenant isolation, input validation, webhook signature.
7. Recovery: backup, restore, migration rollback.

Minimal invariant:

- Inventory tidak berubah tanpa movement.
- Jurnal seimbang.
- Completed transaction tidak dihapus.
- Request idempoten tidak menghasilkan duplikasi.
