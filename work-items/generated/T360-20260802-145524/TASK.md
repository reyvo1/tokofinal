# T360-20260802-145524 — Menegakkan isolasi company dan branch di seluruh endpoint

## Mulai dari sini

- Work item: `work-items/active/T360-20260802-145524-menegakkan-isolasi-company-dan-branch-di-seluruh-endpoint.json`
- Modul: `tenant`
- Wave: `W0 — Platform foundation`
- Risiko: `CRITICAL`
- Fase awal: `ANALYSIS`
- Branch yang disarankan: `security/t360-20260802-145524-menegakkan-isolasi-company-dan-branch-di-seluruh-endpoint`
- Feature flag: `platform.tenantIsolation.enforced`

## Tujuan

Menegakkan isolasi company dan branch di seluruh endpoint. Pekerjaan harus mengikuti Development Kit, workflow, tenant isolation, permission, idempotency, audit, serta quality gate repository.

## Aturan bisnis

- Company dan branch selalu berasal dari identitas terverifikasi, bukan parameter bebas pengguna.
- Query lintas tenant ditolak dan dicatat pada audit log.
- Background worker wajib membawa tenant context yang eksplisit.
- Setiap dampak pajak harus memakai tax rule version dan periode berlaku yang dapat diaudit.

## Acceptance criteria

- Seluruh endpoint operasional menerapkan company/branch scope.
- Pengguna cabang A tidak dapat membaca atau mengubah data cabang B.
- Worker dan report job tidak memproses data di luar tenant context.

## Dampak lintas modul

| Domain | Dampak |
|---|---|
| database | MEDIUM |
| inventory | MEDIUM |
| accounting | MEDIUM |
| tax | MEDIUM |
| payment | MEDIUM |
| payroll | MEDIUM |
| sync | MEDIUM |
| security | HIGH |
| performance | MEDIUM |

## Test plan

- Integration test akses silang tenant pada produk, stok, jurnal, pajak, payroll, dan pembayaran.
- Security test token tanpa branch assignment.
- Sync retry test memastikan envelope tenant tetap idempotent.

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

- `docs/DEVELOPMENT-KIT.md`
- `docs/DEVELOPMENT-WORKFLOW.md`
- `docs/ENTERPRISE-ACCOUNTING-TAX.md`
