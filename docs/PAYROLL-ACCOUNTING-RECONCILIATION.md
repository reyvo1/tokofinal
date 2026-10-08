# Payroll Accounting & Liability Reconciliation

Status: implemented baseline hardening — 2026-09-11.

## Lifecycle

`OPEN PERIOD -> LOCK ATTENDANCE -> CALCULATE -> REVIEW -> APPROVE -> POST ACCOUNTING -> PAY SALARY -> SETTLE TAX/SOCIAL LIABILITIES -> PUBLISH PAYSLIP`

Kalkulasi dan posting adalah dua tahap terpisah. Approval payroll tidak memindahkan uang. Posting payroll hanya mengakui beban dan kewajiban. Pembayaran aktual selalu menghasilkan event/jurnal settlement yang terpisah.

## Posting payroll

Account code diselesaikan melalui `PayrollAccountingMapping` untuk company/branch. Mapping canonical seed menggunakan logical component code:

- `__PAYROLL_EXPENSE__` -> debit beban payroll;
- `__SALARY_PAYABLE__` -> credit Utang Gaji;
- `__PAYROLL_TAX_PAYABLE__` -> credit Utang PPh Payroll;
- `__PAYROLL_OTHER_PAYABLE__` -> credit BPJS/potongan/employer contribution payable.

Debit beban dihitung sebagai jumlah credit yang benar-benar diakui (`net pay + tax payable + other payroll payable`). Pola ini menjaga jurnal tetap balance walaupun ada reimbursement/net component yang sengaja tidak ditandai sebagai gross.

## Pembayaran gaji

Setelah payroll diposting, satu `PayrollPayment` disiapkan per employee result yang mempunyai net pay positif. Settlement:

- Dr Utang Gaji;
- Cr Kas/Bank.

Untuk akun selain Kas tunai default, server mewajibkan `externalReference` agar konfirmasi bank dapat diaudit. `accountingEventId` pada `PayrollPayment` bersifat unique sehingga satu payment hanya menunjuk satu accounting event.

## Settlement PPh/BPJS/potongan

`PAYROLL_LIABILITY_PAYMENT` harus mereferensikan `PayrollRun` yang sudah `POSTED/PAID`.

- akun 2103: recognized liability = `PayrollRun.taxTotal`;
- akun 2104: recognized liability = employee deductions/contributions + employer contribution;
- draft/approved settlement mereservasi saldo tersedia;
- posted settlement mengurangi outstanding;
- create dan post sama-sama melakukan revalidation sehingga dua draft/concurrent request tidak dapat membayar lebih besar dari liability.

Posting settlement:

- Dr kewajiban payroll (2103 atau 2104);
- Cr Kas/Bank.

## Deployment existing database

Apply migration `database/migrations/T360-20260911-payroll-liability-integrity/`, deploy source, lalu jalankan canonical configuration seed/upsert secara aman agar `PayrollAccountingMapping`, `PAYROLL-SALARY-PAYMENT`, dan `PAYROLL-LIABILITY-PAYMENT` tersedia. Setelah itu lakukan runtime test di TEST/STAGING menggunakan database yang menyerupai production.

## Validation boundary

Static/regression tests dapat membuktikan source guard, schema consistency, dan workflow contracts. Mereka tidak menggantikan runtime integration test NestJS + Prisma + PostgreSQL/SQLite + accounting event posting. Production gate tetap membutuhkan uji runtime terhadap database hasil migration.

## Effective-dated profile safety

Employee tax and social-security profiles are versioned by `(employeeId, effectiveFrom)`. The payroll engine deliberately requires one profile/rule version to cover the **entire** payroll period. A profile or statutory rule that starts/ends mid-period is not silently stretched across the month; the result must remain `REQUIRES_REVIEW` until a split-period/proration workflow is explicitly implemented.

