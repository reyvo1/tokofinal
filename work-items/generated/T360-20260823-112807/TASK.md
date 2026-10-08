# T360-20260823-112807 — Membuat nomor dokumen atomik per company branch dan jenis dokumen

## Mulai dari sini

- Work item: `work-items/active/T360-20260823-112807-membuat-nomor-dokumen-atomik-per-company-branch-dan-jenis-do.json`
- Modul: `database`
- Wave: `W0 — Platform foundation`
- Risiko: `HIGH`
- Fase awal: `ANALYSIS`
- Branch yang disarankan: `feature/t360-20260823-112807-membuat-nomor-dokumen-atomik-per-company-branch-dan-jenis-do`
- Feature flag: `platform.atomicNumberSequence.enabled`

## Tujuan

Membuat nomor dokumen atomik per company branch dan jenis dokumen. Pekerjaan harus mengikuti Development Kit, workflow, tenant isolation, permission, idempotency, audit, serta quality gate repository.

## Aturan bisnis

- Nomor dokumen unik per company, branch, jenis dokumen, dan periode.
- Retry atau sync ulang tidak boleh mengonsumsi nomor baru untuk operation yang sama.

## Acceptance criteria

- Tidak terjadi nomor duplikat pada transaksi paralel.
- Format nomor dapat dikonfigurasi tanpa mengubah ID UUID.

## Dampak lintas modul

| Domain | Dampak |
|---|---|
| database | HIGH |
| inventory | LOW |
| accounting | LOW |
| tax | LOW |
| payment | LOW |
| payroll | LOW |
| sync | MEDIUM |
| security | LOW |
| performance | MEDIUM |

## Test plan

- Concurrency test 100 generator nomor pada branch yang sama.
- Idempotency retry test untuk operation yang sama.
- Migration test expand-only pada SQLite dan PostgreSQL.
- Inventory movement dan rekonsiliasi stok test sesuai scope pekerjaan.
- Journal debit-credit dan idempotent posting test sesuai event pekerjaan.

## Migration plan

Gunakan migration expand-only, jaga parity SQLite dan PostgreSQL, siapkan backfill terpisah, validasi index/query plan, dan jangan memakai db push pada production.

## Rollback plan

Nonaktifkan feature flag bila tersedia, rollback deployment, hentikan consumer baru, dan gunakan compensating operation untuk transaksi yang sudah diposting.

## Monitoring plan

Tambahkan metric sukses/gagal, latency, queue age, retry, structured log, alert threshold, dan masa observasi setelah rilis.

## Security notes

Terapkan autentikasi, permission granular, company/branch scope, perlindungan data sensitif, audit trail, dan larangan menyimpan credential pada source code.

## File yang kemungkinan relevan

- `docs/DATABASE-PROFILES.md`

## Dokumen sumber

- `docs/DEVELOPMENT-KIT.md`
- `docs/LARGE-SCALE-DATA.md`
