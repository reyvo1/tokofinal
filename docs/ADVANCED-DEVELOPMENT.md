# Pengembangan Tahap Lanjutan

## Arti Status

- **Implemented**: alur dasar sudah bekerja dalam service/API.
- **Foundation**: schema, endpoint, dan extension point tersedia; aturan bisnis perlu diperdalam.
- **Adapter-ready**: kontrak tersedia; provider/credential belum dipasang.
- **Data-ready**: model data tersedia untuk dikembangkan menjadi dashboard/worker.

| Fitur | Status | Komponen |
|---|---|---|
| Multi-cabang | Implemented | Company, Branch, branch-scoped user/account/sale/order |
| Multi-gudang | Implemented | Warehouse, inventory per warehouse |
| Transfer gudang | Implemented | StockTransfer API, ship/receive atomik |
| Stock opname | Implemented | Snapshot, count, submit, adjustment |
| Payment gateway | Adapter-ready | IntegrationConnection, plugin SDK, webhook/outbox |
| Marketplace | Foundation/Adapter-ready | MarketplaceOrder, external mapping, plugin contract |
| Ekspedisi | Foundation/Adapter-ready | Shipment dan shipping contract |
| WhatsApp | Foundation/Adapter-ready | Notification queue/template contract |
| Customer mobile app | API-ready | Runtime manifest dan shared contracts |
| POS offline | Foundation | Device dan OfflineTransaction idempotency queue |
| Batch/kedaluwarsa | Foundation | InventoryBatch dan goods receipt batch fields |
| Serial number | Foundation | InventorySerial |
| Loyalty/membership | Foundation | Program, account, transaction, tier JSON |
| Akuntansi lengkap | Foundation | Journals, accounts, fiscal period; tambah ledger reports/closing rules |
| Rekonsiliasi bank | Foundation | Statement import dan reconciliation record |
| Approval bertingkat | Foundation | Policy, request, decision |
| Forecasting | Implemented baseline | Moving average |
| Reorder suggestion | Implemented baseline | Forecast-generated suggestions |
| BI | Data-ready | Domain tables/outbox; tambah warehouse/semantic layer |
| Timbangan | Adapter-ready | Plugin/custom device contract |
| API pihak ketiga | Foundation | API key, plugin SDK, webhook, external mapping |
| Retur penjualan | Foundation | Create/complete/restock/outbox |
| Retur pembelian | Foundation | Create/complete/stock reduction/outbox |

## Urutan Produksi yang Disarankan

1. Stabilkan core stok dan finance dengan integration tests.
2. Tambahkan tenant scoping pada seluruh query jika menjadi SaaS.
3. Pasang Redis/queue workers untuk outbox, webhook, notification, sync.
4. Pilih payment, shipping, marketplace, dan WhatsApp provider.
5. Implementasikan secret manager dan encryption service.
6. Bangun halaman admin dinamis dari runtime manifest/UI schema.
7. Tambahkan observability, backup restore drill, load test, dan security review.
