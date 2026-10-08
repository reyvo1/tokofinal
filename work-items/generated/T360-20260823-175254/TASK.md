# T360-20260823-175254 — Menerapkan idempotency pada seluruh transaksi mutasi utama

## Mulai dari sini

- Work item: `work-items/active/T360-20260823-175254-menerapkan-idempotency-pada-seluruh-transaksi-mutasi-utama.json`
- Modul: `platform`
- Wave: `W0 — Platform foundation`
- Risiko: `CRITICAL`
- Fase awal: `ANALYSIS`
- Branch yang disarankan: `feature/t360-20260823-175254-menerapkan-idempotency-pada-seluruh-transaksi-mutasi-utama`
- Feature flag: `platform.idempotency.required`

## Tujuan

Menerapkan idempotency pada seluruh transaksi mutasi utama. Pekerjaan harus mengikuti Development Kit, workflow, tenant isolation, permission, idempotency, audit, serta quality gate repository.

## Aturan bisnis

- Operation ID yang sama menghasilkan receipt yang sama dan tidak membuat transaksi kedua.
- Versi dan periode pajak pada replay harus sama dengan posting awal.
- Receipt idempotency mempunyai masa retensi sesuai jenis transaksi.

## Acceptance criteria

- Penjualan, penerimaan supplier, pembayaran, retur, payroll, aset, dan inspeksi aman terhadap retry.
- Duplicate request menghasilkan respons konsisten tanpa stock movement atau journal baru.

## Dampak lintas modul

| Domain | Dampak |
|---|---|
| database | HIGH |
| inventory | HIGH |
| accounting | HIGH |
| tax | HIGH |
| payment | HIGH |
| payroll | HIGH |
| sync | HIGH |
| security | MEDIUM |
| performance | MEDIUM |

## Test plan

- Idempotency test penjualan dan inventory movement.
- Retry test payment webhook dan sync offline.
- Journal debit-credit test memastikan tidak ada posting ganda.
- Tax transaction replay test berdasarkan versi aturan berlaku.

## Migration plan

Gunakan migration expand-only, jaga parity SQLite dan PostgreSQL, siapkan backfill terpisah, validasi index/query plan, dan jangan memakai db push pada production.

## Rollback plan

Nonaktifkan feature flag bila tersedia, rollback deployment, hentikan consumer baru, dan gunakan compensating operation untuk transaksi yang sudah diposting.

## Monitoring plan

Tambahkan metric sukses/gagal, latency, queue age, retry, structured log, alert threshold, dan masa observasi setelah rilis.

## Security notes

Terapkan autentikasi, permission granular, company/branch scope, perlindungan data sensitif, audit trail, dan larangan menyimpan credential pada source code.

## File yang kemungkinan relevan

- `apps/api/src/platform`
- `apps/api/src/platform/dto`
- `apps/api/src/platform/platform.controller.ts`
- `apps/api/src/platform/platform.module.ts`
- `apps/api/src/platform/platform.service.ts`
- `apps/api/src/platform/plugin-registry.service.ts`
- `apps/api/src/platform/plugins`

## Dokumen sumber

- `docs/DEVELOPMENT-KIT.md`
- `docs/AUTOMATION-RULEBOOK.md`
- `docs/ENTERPRISE-ACCOUNTING-TAX.md`
