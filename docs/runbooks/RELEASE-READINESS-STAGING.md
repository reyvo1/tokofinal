# Stage 20 — UAT, Observability, Query Plan, and Release Readiness

Tahap ini hanya untuk TEST/STAGING. Production ditolak oleh validasi target.

## Remediasi indeks kritis

Sebelum observasi, lima indeks additive/idempoten diterapkan pada staging untuk query tenant dan pagination:

- Product: `companyId, isActive, name, id`.
- Warehouse: `branchId`.
- Inventory: `warehouseId, updatedAt, id`.
- AccountingEvent: `companyId, branchId, createdAt, id`.
- PayrollRun: `companyId, branchId, createdAt`.

Schema Prisma SQLite/PostgreSQL/canonical diselaraskan. Production memerlukan change approval terpisah.

## Gate otomatis

- Evidence Tahap 18 dan 19 wajib lulus.
- API build dijalankan pada port observasi sementara.
- Health endpoint disampling dan p95 dibandingkan dengan budget.
- PostgreSQL activity, deadlock, connection, queue, ownership, dan denial audit dicatat.
- Query utama diperiksa menggunakan `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`.
- Index kritis untuk tenant-filter dan pagination diperiksa secara eksplisit.

## UAT manusia

Isi `stage20-uat-results.json` setelah seluruh skenario diuji pada staging. Seluruh **12 skenario kritis** wajib `PASS`, termasuk Delivery Lifecycle dan Payroll Adjustment/Recovery; keputusan hanya `GO_FOR_RELEASE_READY`, bukan izin deploy production.

## Hasil

Jika seluruh gate lulus, work item dipindahkan ke `RELEASE_READY`. Tahap ini tidak memindahkan work item ke `RELEASED` atau `CLOSED` dan tidak menyentuh production.

## Skenario tambahan source-closure

- `UAT-11-DELIVERY-LIFECYCLE`: seluruh trip outbound dari assignment hingga close trip, termasuk POD/COD dan failed/return.
- `UAT-12-PAYROLL-ADJUSTMENT-RECOVERY`: differential correction atas payroll POSTED/PAID, signed journal, liability chain, recovery, cancellation pre-posting, dan lineage payslip/report.

Stage-20 evidence membawa `sourceIdentity` SHA-256. Evidence yang fingerprint-nya berbeda dari source yang sedang diverifikasi tidak boleh dipakai untuk menyatakan kandidat UAT.
