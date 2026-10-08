# T360-20260823-224526 — Menyelesaikan payroll approval pajak jurnal slip dan pembayaran

## Mulai dari sini

- Work item: `work-items/active/T360-20260823-224526-menyelesaikan-payroll-approval-pajak-jurnal-slip-dan-pembaya.json`
- Modul: `payroll`
- Wave: `W4 — HR and payroll`
- Risiko: `CRITICAL`
- Fase awal: `ANALYSIS`
- Branch yang disarankan: `feature/t360-20260823-224526-menyelesaikan-payroll-approval-pajak-jurnal-slip-dan-pembaya`
- Feature flag: `hr.payroll.productionReady`

## Tujuan

Menyelesaikan payroll approval pajak jurnal slip dan pembayaran. Pekerjaan harus mengikuti Development Kit, workflow, tenant isolation, permission, idempotency, audit, serta quality gate repository.

## Aturan bisnis

- Payroll posted tidak diedit langsung; koreksi melalui adjustment.
- Pajak payroll memakai rule version dan periode berlaku yang disetujui.
- Slip gaji hanya dapat diakses pemilik akun atau role berwenang.

## Acceptance criteria

- Absensi, lembur, komponen, pajak, jaminan sosial, jurnal, pembayaran, dan slip gaji terhubung.
- Batch payroll dapat diulang tanpa posting ganda.

## Dampak lintas modul

| Domain | Dampak |
|---|---|
| database | HIGH |
| inventory | NONE |
| accounting | HIGH |
| tax | HIGH |
| payment | HIGH |
| payroll | HIGH |
| sync | MEDIUM |
| security | HIGH |
| performance | HIGH |

## Test plan

- Payroll calculation dan tax period test.
- Journal debit-credit serta payment settlement test.
- Idempotency retry test payroll posting.
- Security test payslip self-scope dan audit.

## Migration plan

Gunakan migration expand-only, jaga parity SQLite dan PostgreSQL, siapkan backfill terpisah, validasi index/query plan, dan jangan memakai db push pada production.

## Rollback plan

Nonaktifkan feature flag bila tersedia, rollback deployment, hentikan consumer baru, dan gunakan compensating operation untuk transaksi yang sudah diposting.

## Monitoring plan

Tambahkan metric sukses/gagal, latency, queue age, retry, structured log, alert threshold, dan masa observasi setelah rilis.

## Security notes

Terapkan autentikasi, permission granular, company/branch scope, perlindungan data sensitif, audit trail, dan larangan menyimpan credential pada source code.

## File yang kemungkinan relevan

- `apps/admin/app/modules/hr-payroll.tsx`
- `apps/api/src/payroll`
- `apps/api/src/payroll/dto`
- `apps/api/src/payroll/payroll.controller.ts`
- `apps/api/src/payroll/payroll.module.ts`
- `apps/api/src/payroll/payroll.service.ts`
- `docs/HRIS-ATTENDANCE-PAYROLL.md`
- `docs/PAYROLL-TAX-INDONESIA.md`

## Dokumen sumber

- `docs/HRIS-ATTENDANCE-PAYROLL.md`
- `docs/PAYROLL-TAX-INDONESIA.md`
