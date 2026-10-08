# T360-20260823-181947 — Memperkuat mutasi stok atomik dan retry concurrency

## Mulai dari sini

- Work item: `work-items/active/T360-20260823-181947-memperkuat-mutasi-stok-atomik-dan-retry-concurrency.json`
- Modul: `inventory`
- Wave: `W1 — Master and inventory core`
- Risiko: `CRITICAL`
- Fase awal: `ANALYSIS`
- Branch yang disarankan: `feature/t360-20260823-181947-memperkuat-mutasi-stok-atomik-dan-retry-concurrency`
- Feature flag: `inventory.atomicMutation.enabled`

## Tujuan

Memperkuat mutasi stok atomik dan retry concurrency. Pekerjaan harus mengikuti Development Kit, workflow, tenant isolation, permission, idempotency, audit, serta quality gate repository.

## Aturan bisnis

- Saldo stok hanya berubah melalui inventory movement append-only.
- Pengurangan stok atomik gagal bila available quantity tidak mencukupi.
- Retry serializable dibatasi dan dicatat untuk monitoring.
- Setiap dampak pajak harus memakai tax rule version dan periode berlaku yang dapat diaudit.

## Acceptance criteria

- Dua kasir tidak dapat menjual unit terakhir secara bersamaan.
- Saldo inventory sama dengan agregasi movement untuk sampel dan rekonsiliasi penuh.

## Dampak lintas modul

| Domain | Dampak |
|---|---|
| database | HIGH |
| inventory | HIGH |
| accounting | MEDIUM |
| tax | LOW |
| payment | LOW |
| payroll | NONE |
| sync | HIGH |
| security | MEDIUM |
| performance | HIGH |

## Test plan

- Concurrency test penjualan barang terakhir.
- Inventory movement invariant test.
- Offline sync retry dan conflict test.
- Journal inventory posting balance test.

## Migration plan

Gunakan migration expand-only, jaga parity SQLite dan PostgreSQL, siapkan backfill terpisah, validasi index/query plan, dan jangan memakai db push pada production.

## Rollback plan

Nonaktifkan feature flag bila tersedia, rollback deployment, hentikan consumer baru, dan gunakan compensating operation untuk transaksi yang sudah diposting.

## Monitoring plan

Tambahkan metric sukses/gagal, latency, queue age, retry, structured log, alert threshold, dan masa observasi setelah rilis.

## Security notes

Terapkan autentikasi, permission granular, company/branch scope, perlindungan data sensitif, audit trail, dan larangan menyimpan credential pada source code.

## File yang kemungkinan relevan

- `apps/api/src/advanced-inventory`
- `apps/api/src/advanced-inventory/advanced-inventory.controller.ts`
- `apps/api/src/advanced-inventory/advanced-inventory.module.ts`
- `apps/api/src/advanced-inventory/advanced-inventory.service.ts`
- `apps/api/src/advanced-inventory/dto`
- `apps/api/src/inventory`
- `apps/api/src/inventory/inventory.controller.ts`
- `apps/api/src/inventory/inventory.module.ts`
- `apps/api/src/inventory/inventory.service.ts`

## Dokumen sumber

- `docs/DEVELOPMENT-KIT.md`
- `docs/LARGE-SCALE-DATA.md`
- `docs/PERFORMANCE-CHECKLIST.md`
