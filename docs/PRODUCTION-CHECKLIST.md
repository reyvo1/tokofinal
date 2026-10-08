# Checklist Sebelum Produksi

- [ ] Migration terversi, bukan hanya `prisma db push`.
- [ ] Integration dan concurrency tests lulus.
- [ ] Secret manager dan encryption aktif.
- [ ] Refresh token rotation, 2FA admin, rate limiting.
- [ ] API key scoped lifecycle diuji bila external API access diaktifkan; bila tidak, akses external API tetap disabled.
- [ ] Tenant/company scoping diuji pada semua endpoint.
- [ ] Kapasitas/backpressure worker outbox/webhook/notification/offline sync tervalidasi; DB polling boleh dipakai sesuai Development Kit, Redis/BullMQ adalah adapter opsional bila dibutuhkan skala.
- [ ] Webhook signature, idempotency, retry, dead-letter queue.
- [ ] Backup terenkripsi dan restore drill.
- [ ] Monitoring, alerting, tracing, centralized logs.
- [ ] Payment/provider certification dan reconciliation.
- [ ] Financial opening balances dan chart of accounts diverifikasi.
- [ ] Stock opening balance dan opname awal.
- [ ] Load test POS/order/checkout.
- [ ] SAST, dependency scan, DAST, dan penetration test/review keamanan sebelum go-live.
- [ ] Privacy policy, retention, and access review.

## Large-scale readiness

- [ ] PostgreSQL digunakan untuk server multi-user.
- [ ] Semua endpoint daftar memiliki limit/cursor.
- [ ] Tidak ada laporan yang memuat seluruh tabel ke RAM aplikasi.
- [ ] Indeks query utama telah diuji dengan EXPLAIN ANALYZE.
- [ ] Atomic stock update dan serialization retry tersedia.
- [ ] Idempotency key diterapkan pada semua mutasi.
- [ ] NumberSequence atomik digunakan untuk nomor bisnis.
- [ ] Daily summaries dan report jobs tersedia sebelum data jutaan.
- [ ] Slow query logging, connection monitoring, dan queue monitoring aktif.
- [ ] Retention/archiving policy disetujui.
- [ ] Load test menggunakan volume dan concurrency representatif.
- [ ] Backup database besar pernah direstore dan diverifikasi.

## Enterprise accounting and tax

- [ ] Chart of accounts per branch has been reviewed.
- [ ] Every active event type has exactly one valid posting rule for the effective date.
- [ ] All tax codes, rates, rounding rules, effective dates, documents, and legal references are verified.
- [ ] DRAFT tax/payroll rules cannot be used by production transactions.
- [ ] Fiscal close control, reversal, approval, and audit have been tested.
- [ ] Sales, purchase, return, stock, expense, asset, fleet, and payroll journals reconcile to subledgers.

## Assets and fleet

- [ ] Asset opening balances and book values are reconciled.
- [ ] Useful life, residual value, depreciation accounts, and methods are approved.
- [ ] Vehicle capacity, documents, maintenance thresholds, drivers, and odometer sources are configured.
- [ ] Pre-trip, post-trip, loading, proof-of-delivery, gate pass, COD, and failed-delivery flows are tested.

## Inbound and outbound control

- [ ] Operation policies are assigned per branch.
- [ ] Inspection templates and blocking severities are approved.
- [ ] Barcode, batch, serial, photo/evidence, confirmation, tolerance, and gate-pass rules are tested.
- [ ] Supplier receipts do not affect available stock before confirmation.
- [ ] Return flows reverse inventory, accounting, and tax once only.

## Automation

- [ ] Outbox, automation jobs, retry, dead-letter, and idempotency are monitored.
- [ ] External-provider failure does not roll back committed business transactions.
- [ ] Secrets are stored outside the database/source code.
