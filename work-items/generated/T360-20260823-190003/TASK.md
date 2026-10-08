# T360-20260823-190003 — Menstabilkan POS shift pembayaran refund dan rekonsiliasi

## Mulai dari sini

- Work item: `work-items/active/T360-20260823-190003-menstabilkan-pos-shift-pembayaran-refund-dan-rekonsiliasi.json`
- Modul: `pos`
- Wave: `W2 — Commerce channels`
- Risiko: `CRITICAL`
- Fase awal: `ANALYSIS`
- Branch yang disarankan: `feature/t360-20260823-190003-menstabilkan-pos-shift-pembayaran-refund-dan-rekonsiliasi`
- Feature flag: `commerce.pos.productionReady`

## Tujuan

Menstabilkan POS shift pembayaran refund dan rekonsiliasi. Pekerjaan harus mengikuti Development Kit, workflow, tenant isolation, permission, idempotency, audit, serta quality gate repository.

## Aturan bisnis

- Shift wajib dibuka sebelum transaksi dan ditutup dengan rekonsiliasi kas.
- Refund harus merujuk transaksi asli dan membalik stock, journal, payment, serta pajak secara idempotent.

## Acceptance criteria

- Tunai, transfer, QRIS, kartu, split payment, hold, refund, dan close shift tercatat konsisten.
- Transaksi lokal dapat disinkronkan tanpa duplikasi.

## Dampak lintas modul

| Domain | Dampak |
|---|---|
| database | MEDIUM |
| inventory | HIGH |
| accounting | HIGH |
| tax | HIGH |
| payment | HIGH |
| payroll | LOW |
| sync | HIGH |
| security | HIGH |
| performance | HIGH |

## Test plan

- E2E POS sale-payment-stock-journal-tax.
- Payment callback replay test.
- Offline sync retry/conflict test.
- Concurrency dan performance test banyak kasir.

## Migration plan

Gunakan migration expand-only, jaga parity SQLite dan PostgreSQL, siapkan backfill terpisah, validasi index/query plan, dan jangan memakai db push pada production.

## Rollback plan

Nonaktifkan feature flag bila tersedia, rollback deployment, hentikan consumer baru, dan gunakan compensating operation untuk transaksi yang sudah diposting.

## Monitoring plan

Tambahkan metric sukses/gagal, latency, queue age, retry, structured log, alert threshold, dan masa observasi setelah rilis.

## Security notes

Terapkan autentikasi, permission granular, company/branch scope, perlindungan data sensitif, audit trail, dan larangan menyimpan credential pada source code.

## File yang kemungkinan relevan

- `apps/api/prisma/schema.postgresql.prisma`
- `apps/pos`
- `apps/pos/.next`
- `apps/pos/app`
- `apps/pos/app/globals.css`
- `apps/pos/app/layout.tsx`
- `apps/pos/app/page.tsx`
- `apps/pos/next-env.d.ts`
- `apps/pos/package.json`
- `apps/pos/tsconfig.json`
- `apps/pos/tsconfig.tsbuildinfo`
- `docs/Toko360.postman_collection.json`

## Dokumen sumber

- `docs/DEVELOPMENT-KIT.md`
- `docs/ENTERPRISE-ACCOUNTING-TAX.md`
- `docs/PERFORMANCE-CHECKLIST.md`
