# T360-20260823-223247 — Menyelesaikan laporan keuangan period close dan rekonsiliasi

## Mulai dari sini

- Work item: `work-items/active/T360-20260823-223247-menyelesaikan-laporan-keuangan-period-close-dan-rekonsiliasi.json`
- Modul: `financial-reporting`
- Wave: `W3 — Accounting and tax core`
- Risiko: `HIGH`
- Fase awal: `ANALYSIS`
- Branch yang disarankan: `feature/t360-20260823-223247-menyelesaikan-laporan-keuangan-period-close-dan-rekonsiliasi`
- Feature flag: `finance.reporting.productionReady`

## Tujuan

Menyelesaikan laporan keuangan period close dan rekonsiliasi. Pekerjaan harus mengikuti Development Kit, workflow, tenant isolation, permission, idempotency, audit, serta quality gate repository.

## Aturan bisnis

- Laporan bersumber dari posting yang sudah disetujui dan periode fiskal yang jelas.
- Perubahan setelah close memakai adjustment atau reopening terotorisasi.

## Acceptance criteria

- Laba rugi, neraca, arus kas, buku besar, pajak, utang, dan piutang dapat direkonsiliasi.
- Laporan besar berjalan sebagai report job asynchronous.

## Dampak lintas modul

| Domain | Dampak |
|---|---|
| database | HIGH |
| inventory | LOW |
| accounting | HIGH |
| tax | HIGH |
| payment | MEDIUM |
| payroll | MEDIUM |
| sync | LOW |
| security | HIGH |
| performance | HIGH |

## Test plan

- Journal-to-report reconciliation test.
- Tax period reconciliation test.
- Security test akses laporan lintas branch.
- Performance test jutaan journal line melalui summary/report job.
- Inventory movement dan rekonsiliasi stok test sesuai scope pekerjaan.
- Sync idempotency, retry, offline, dan conflict test sesuai scope pekerjaan.

## Migration plan

Gunakan migration expand-only, jaga parity SQLite dan PostgreSQL, siapkan backfill terpisah, validasi index/query plan, dan jangan memakai db push pada production.

## Rollback plan

Nonaktifkan feature flag bila tersedia, rollback deployment, hentikan consumer baru, dan gunakan compensating operation untuk transaksi yang sudah diposting.

## Monitoring plan

Tambahkan metric sukses/gagal, latency, queue age, retry, structured log, alert threshold, dan masa observasi setelah rilis.

## Security notes

Terapkan autentikasi, permission granular, company/branch scope, perlindungan data sensitif, audit trail, dan larangan menyimpan credential pada source code.

## File yang kemungkinan relevan

- Cari implementasi terkait menggunakan nama modul dan event bisnis.

## Dokumen sumber

- `docs/ENTERPRISE-ACCOUNTING-TAX.md`
- `docs/LARGE-SCALE-DATA.md`
