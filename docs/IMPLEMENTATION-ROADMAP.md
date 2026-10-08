# Implementation Roadmap Toko360

Roadmap ini mengatur urutan pengerjaan. Status aktual setiap pekerjaan berada pada `work-items/active/` dan bukan pada teks roadmap ini.

## Milestone A — Stabilitas fondasi

- Tenant/branch isolation konsisten.
- Permission guard di seluruh endpoint.
- Number sequence atomik.
- Idempotency pada seluruh mutasi penting.
- Migration strategy SQLite/PostgreSQL.
- Audit dan observability baseline.

## Milestone B — Inventory dan commerce production-ready

- Atomic stock update dan retry serializable.
- Inbound/outbound inspection lengkap.
- POS shift, payment, refund, dan reconciliation.
- Website order, reservation, fulfillment, dan delivery.
- Pagination, indeks, dan load test data besar.

## Milestone C — Accounting dan tax end-to-end

- Posting rules seluruh transaksi.
- Period close dan reversal.
- Supplier payable settlement berbasis Goods Receipt sudah tersedia; customer receivable settlement masih tahap berikutnya.
- Tax input/output/withholding serta return reversal.
- Laporan keuangan dan tax reconciliation.

## Milestone D — HR, payroll, aset, dan fleet

- Absensi fingerprint/photo/GPS.
- Shift, leave, overtime, payroll approval.
- Asset lifecycle dan depreciation.
- Vehicle maintenance, trip, manifest, COD.
- Employee portal dan notification.

## Milestone E — Hybrid edge-cloud

- Node identity dan credential rotation.
- Bidirectional sync protocol.
- Checkpoint, receipt, retry, conflict, dead letter.
- Device bridge untuk fingerprint, printer, scanner, dan timbangan.
- Offline recovery drill.

## Milestone F — Scale dan hardening

- Partitioning dan retention.
- Read replica/reporting workload.
- Queue, backpressure, and worker scaling.
- Backup/restore drill.
- Security review dan production readiness.

Setiap milestone hanya dapat ditutup apabila exit criteria pada `config/module-delivery-map.json` terpenuhi.
