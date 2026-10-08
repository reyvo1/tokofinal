# Asset & Fleet Accounting Reconciliation

## Posting map

| Source | Event | Debit | Credit / settlement |
|---|---|---|---|
| Asset acquisition cash/bank | `ASSET_ACQUISITION_CASH` | Asset + input tax | Kas/Bank |
| Asset acquisition credit | `ASSET_ACQUISITION_CREDIT` | Asset + input tax | Utang Usaha `2101` |
| Depreciation | `ASSET_DEPRECIATION` | Depreciation expense | Accumulated depreciation |
| Maintenance vendor cash/bank | `ASSET_MAINTENANCE_CASH` | Maintenance expense + input tax | Kas/Bank |
| Maintenance vendor credit | `ASSET_MAINTENANCE_CREDIT` | Maintenance expense + input tax | Utang Usaha `2101` |
| Maintenance part consumption | `ASSET_MAINTENANCE_PARTS` | Maintenance expense | Inventory `1301` |
| Fuel cash/bank | `FLEET_FUEL_CASH` | Fuel expense + input tax | Kas/Bank |
| Fuel credit | `FLEET_FUEL_CREDIT` | Fuel expense + input tax | Utang Usaha `2101` |
| Asset sale/disposal | `ASSET_DISPOSAL` | Cash/Bank + accumulated dep + loss | Asset cost + output tax + gain |
| Supplier settlement | `SUPPLIER_PAYMENT` | Utang Usaha `2101` | Kas/Bank |

## Integrity rules

1. Business date berasal dari transaksi sumber (`acquisitionDate`, `completedAt`, `transactionDate`, `disposedAt`), bukan selalu waktu request API.
2. Liability kredit harus mempunyai supplier trace sebelum dapat diposting/dibayar.
3. Pembayaran supplier dihitung sebagai `gross - paid - pending` dan direvalidasi saat posting.
4. Depresiasi `POSTED` tidak boleh mempunyai periode overlap.
5. Disposal harus lolos book-value invariant sebelum jurnal dibuat.
6. Maintenance part mengubah stock dan journal dalam transaksi database yang sama.
7. Fuel retry harus mempunyai receipt/evidence trace yang stabil.
8. Penjualan aset kredit belum diaktifkan; jangan memetakan proceeds ke AR tanpa customer/counterparty source.

## Known safe limitations

- Maintenance part dengan serial number ditolak sampai serial-consumption workflow tersedia.
- Asset transfer endpoint saat ini hanya intra-branch custody/location transfer.
- Depreciation engine pada baseline ini hanya mengimplementasikan straight-line.
- Full NestJS + Prisma + database runtime integration masih harus dijalankan di TEST/STAGING sebelum production.
