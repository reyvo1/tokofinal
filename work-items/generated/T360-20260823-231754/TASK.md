# T360-20260823-231754 — Menerapkan partitioning retention summary queue dan performance budget

## Mulai dari sini

- Work item: `work-items/active/T360-20260823-231754-menerapkan-partitioning-retention-summary-queue-dan-performa.json`
- Modul: `performance`
- Wave: `W7 — Scale, analytics, and production hardening`
- Risiko: `HIGH`
- Fase awal: `ANALYSIS`
- Branch yang disarankan: `performance/t360-20260823-231754-menerapkan-partitioning-retention-summary-queue-dan-performa`
- Feature flag: `platform.largeScale.enabled`

## Tujuan

Menerapkan partitioning retention summary queue dan performance budget. Pekerjaan harus mengikuti Development Kit, workflow, tenant isolation, permission, idempotency, audit, serta quality gate repository.

## Aturan bisnis

- Hot table dipartisi dan diarsipkan sesuai retention policy yang dapat diaudit.
- Query daftar memakai cursor pagination dan laporan besar memakai summary/report job.
- Perubahan pajak atau jurnal lama tidak dihapus oleh retention.

## Acceptance criteria

- Target jutaan transaksi memenuhi performance budget.
- Archive dapat direstorasi dan direkonsiliasi dengan ledger.

## Dampak lintas modul

| Domain | Dampak |
|---|---|
| database | HIGH |
| inventory | MEDIUM |
| accounting | MEDIUM |
| tax | MEDIUM |
| payment | LOW |
| payroll | LOW |
| sync | HIGH |
| security | MEDIUM |
| performance | HIGH |

## Test plan

- Load test produk, sale, inventory movement, journal, tax, payroll, dan sync.
- Archive/restore test.
- Query plan dan index regression test.
- Backpressure dan worker retry test.

## Migration plan

Gunakan migration expand-only, jaga parity SQLite dan PostgreSQL, siapkan backfill terpisah, validasi index/query plan, dan jangan memakai db push pada production.

## Rollback plan

Nonaktifkan feature flag bila tersedia, rollback deployment, hentikan consumer baru, dan gunakan compensating operation untuk transaksi yang sudah diposting.

## Monitoring plan

Tambahkan metric sukses/gagal, latency, queue age, retry, structured log, alert threshold, dan masa observasi setelah rilis.

## Security notes

Terapkan autentikasi, permission granular, company/branch scope, perlindungan data sensitif, audit trail, dan larangan menyimpan credential pada source code.

## File yang kemungkinan relevan

- `docs/PERFORMANCE-CHECKLIST.md`

## Dokumen sumber

- `docs/LARGE-SCALE-DATA.md`
- `docs/PERFORMANCE-CHECKLIST.md`
