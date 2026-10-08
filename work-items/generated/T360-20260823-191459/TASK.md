# T360-20260823-191459 — Menyelesaikan accounting dan tax posting lintas seluruh modul

## Mulai dari sini

- Work item: `work-items/active/T360-20260823-191459-menyelesaikan-accounting-dan-tax-posting-lintas-seluruh-modu.json`
- Modul: `accounting-core`
- Wave: `W3 — Accounting and tax core`
- Risiko: `CRITICAL`
- Fase awal: `ANALYSIS`
- Branch yang disarankan: `feature/t360-20260823-191459-menyelesaikan-accounting-dan-tax-posting-lintas-seluruh-modu`
- Feature flag: `finance.unifiedPosting.enabled`

## Tujuan

Menyelesaikan accounting dan tax posting lintas seluruh modul. Pekerjaan harus mengikuti Development Kit, workflow, tenant isolation, permission, idempotency, audit, serta quality gate repository.

## Aturan bisnis

- Seluruh modul mengirim accounting event dan dilarang membuat journal langsung.
- Tax rule dipilih berdasarkan scope, versi, dan periode berlaku.
- Fiscal period lock mencegah posting mundur tanpa reopening resmi.

## Acceptance criteria

- Penjualan, pembelian, stok, biaya, payroll, aset, fleet, dan retur memakai posting engine yang sama.
- Subledger dapat direkonsiliasi ke general ledger.

## Dampak lintas modul

| Domain | Dampak |
|---|---|
| database | HIGH |
| inventory | MEDIUM |
| accounting | HIGH |
| tax | HIGH |
| payment | HIGH |
| payroll | HIGH |
| sync | MEDIUM |
| security | HIGH |
| performance | HIGH |

## Test plan

- Journal debit-credit test seluruh event type.
- Tax version/effective period test dan reversal test.
- Idempotent accounting posting retry test.
- Performance test posting batch.
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

- `apps/api/src/accounting-core`
- `apps/api/src/accounting-core/accounting-core.controller.ts`
- `apps/api/src/accounting-core/accounting-core.module.ts`
- `apps/api/src/accounting-core/accounting-core.service.ts`
- `apps/api/src/accounting-core/dto`

## Dokumen sumber

- `docs/ENTERPRISE-ACCOUNTING-TAX.md`
- `docs/DEVELOPMENT-KIT.md`
