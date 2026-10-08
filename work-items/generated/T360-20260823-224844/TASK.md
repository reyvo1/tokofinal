# T360-20260823-224844 — Menyelesaikan lifecycle aset kendaraan dan penyusutan

## Mulai dari sini

- Work item: `work-items/active/T360-20260823-224844-menyelesaikan-lifecycle-aset-kendaraan-dan-penyusutan.json`
- Modul: `assets`
- Wave: `W5 — Assets, fleet, and operational control`
- Risiko: `HIGH`
- Fase awal: `ANALYSIS`
- Branch yang disarankan: `feature/t360-20260823-224844-menyelesaikan-lifecycle-aset-kendaraan-dan-penyusutan`
- Feature flag: `operations.assets.enabled`

## Tujuan

Menyelesaikan lifecycle aset kendaraan dan penyusutan. Pekerjaan harus mengikuti Development Kit, workflow, tenant isolation, permission, idempotency, audit, serta quality gate repository.

## Aturan bisnis

- Aset bergerak dan tidak bergerak mempunyai lifecycle, custodian, lokasi, dan bukti.
- Penyusutan memakai policy version dan fiscal period yang terbuka.
- Kendaraan merupakan aset dan biaya servis/BBM diposting melalui accounting core.

## Acceptance criteria

- Perolehan, aktivasi, mutasi, maintenance, depreciation, disposal, dan tax posting tercatat.
- Kendaraan memiliki status operasional dan jadwal servis.

## Dampak lintas modul

| Domain | Dampak |
|---|---|
| database | HIGH |
| inventory | LOW |
| accounting | HIGH |
| tax | HIGH |
| payment | MEDIUM |
| payroll | LOW |
| sync | MEDIUM |
| security | MEDIUM |
| performance | MEDIUM |

## Test plan

- Asset acquisition-journal-tax test.
- Depreciation journal balance dan idempotency test.
- Vehicle maintenance posting test.
- Sync retry test mutasi aset antar branch.
- Inventory movement dan rekonsiliasi stok test sesuai scope pekerjaan.

## Migration plan

Gunakan migration expand-only, jaga parity SQLite dan PostgreSQL, siapkan backfill terpisah, validasi index/query plan, dan jangan memakai db push pada production.

## Rollback plan

Nonaktifkan feature flag bila tersedia, rollback deployment, hentikan consumer baru, dan gunakan compensating operation untuk transaksi yang sudah diposting.

## Monitoring plan

Tambahkan metric sukses/gagal, latency, queue age, retry, structured log, alert threshold, dan masa observasi setelah rilis.

## Security notes

Terapkan autentikasi, permission granular, company/branch scope, perlindungan data sensitif, audit trail, dan larangan menyimpan credential pada source code.

## File yang kemungkinan relevan

- `apps/admin/app/modules/assets-fleet.tsx`
- `apps/api/src/assets`
- `apps/api/src/assets/assets.controller.ts`
- `apps/api/src/assets/assets.module.ts`
- `apps/api/src/assets/assets.service.ts`
- `apps/api/src/assets/dto`

## Dokumen sumber

- `docs/ASSET-FLEET-OPERATIONS.md`
- `docs/ENTERPRISE-ACCOUNTING-TAX.md`
