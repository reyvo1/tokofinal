# T360-20260823-103757 — Menerapkan permission guard pada seluruh endpoint mutasi

## Mulai dari sini

- Work item: `work-items/active/T360-20260823-103757-menerapkan-permission-guard-pada-seluruh-endpoint-mutasi.json`
- Modul: `security`
- Wave: `W0 — Platform foundation`
- Risiko: `HIGH`
- Fase awal: `ANALYSIS`
- Branch yang disarankan: `security/t360-20260823-103757-menerapkan-permission-guard-pada-seluruh-endpoint-mutasi`
- Feature flag: `platform.permissions.enforced`

## Tujuan

Menerapkan permission guard pada seluruh endpoint mutasi. Pekerjaan harus mengikuti Development Kit, workflow, tenant isolation, permission, idempotency, audit, serta quality gate repository.

## Aturan bisnis

- Setiap mutasi mempunyai permission spesifik dan audit trail.
- Approval tidak boleh dilakukan oleh pembuat transaksi jika segregation of duties aktif.
- Setiap dampak pajak harus memakai tax rule version dan periode berlaku yang dapat diaudit.

## Acceptance criteria

- Tidak ada endpoint mutasi tanpa permission metadata.
- Role dinamis dapat diberi atau dicabut permission tanpa perubahan source code.

## Dampak lintas modul

| Domain | Dampak |
|---|---|
| database | LOW |
| inventory | MEDIUM |
| accounting | MEDIUM |
| tax | MEDIUM |
| payment | HIGH |
| payroll | HIGH |
| sync | LOW |
| security | HIGH |
| performance | LOW |

## Test plan

- Unit test permission mapping.
- Integration test akses ditolak pada stock adjustment, journal posting, tax posting, payment refund, dan payroll approval.
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

- `docs/BIOMETRIC-LOCATION-SECURITY.md`

## Dokumen sumber

- `docs/DEVELOPMENT-KIT.md`
- `docs/QUALITY-GATES.md`
