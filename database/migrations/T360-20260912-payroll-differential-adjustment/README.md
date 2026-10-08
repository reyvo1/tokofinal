# T360 differential payroll adjustment migration

This expand-only migration adds the lineage and settlement fields required for corrections after payroll has already been `POSTED`/`PAID`.

## Data model changes

- `PayrollRun.adjustmentOfRunId`: immutable reference to the regular source run.
- `PayrollRun.adjustmentSequence`: ordered adjustment number under one source run.
- `PayrollRun.adjustmentReason`: auditable correction reason.
- `PayrollRun.adjustmentPostingDate`: accounting date for the differential journal, allowing the correction to post in an explicitly open fiscal period instead of silently rewriting the historical posting date.
- `PayrollPayment.direction`: `OUTBOUND` for salary payments and `RECOVERY` when an already-paid overpayment becomes an employee receivable.

No statutory PPh/BPJS rates are inserted by this migration.

## Deployment

1. Backup TEST/STAGING and verify the restore point.
2. Apply the matching expand SQL once.
3. Deploy source and regenerate Prisma Client for the active database profile.
4. Run canonical seed/configuration upsert. It adds account `1204` (`Piutang Karyawan / Payroll Recovery`), mapping `__PAYROLL_RECEIVABLE__`, and posting rule `PAYROLL_EMPLOYEE_RECOVERY` on fresh/canonical environments. Existing production charts may map `__PAYROLL_RECEIVABLE__` to another approved asset account instead of using `1204`.
5. Run payroll adjustment regression plus a TEST/STAGING scenario for positive differential, unpaid salary reduction, paid-salary recovery, and recovery settlement.

The runtime fails closed when a negative PPh/BPJS adjustment would exceed the related unpaid liability. External tax/social-security refunds or offsets must be reconciled explicitly rather than hidden as a negative payable.
