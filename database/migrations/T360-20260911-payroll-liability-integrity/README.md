# T360 Payroll Liability Integrity migration

Expand-only migration for the HR/Payroll accounting hardening stage.

Changes:

- add `PAYROLL_LIABILITY_PAYMENT` as a dedicated finance transaction type for run-scoped payroll tax/social-security liabilities;
- add `PayrollPayment.settlementAccountCode` so salary settlement account is auditable;
- add `PayrollPayment.accountingEventId` with a unique index so each salary payment points to one accounting event;
- replace employee-only payroll profile uniqueness with `(employeeId, effectiveFrom)` so tax/BPJS profile history can be stored safely.

Deployment for an existing database:

1. Backup TEST/STAGING and verify restore point.
2. Apply the matching expand SQL (`postgresql-expand.sql` or `sqlite-expand.sql`).
3. Verify existing employee tax/social-security profiles do not contain duplicate `(employeeId, effectiveFrom)` values, then apply the profile-index migration statements.
4. Deploy source.
5. Run the canonical seed to upsert payroll accounting mappings and posting rules `PAYROLL-SALARY-PAYMENT` and `PAYROLL-LIABILITY-PAYMENT`.
6. Run payroll regression/runtime tests in TEST/STAGING before production.

Do not run demo reset/seed against production data. The canonical configuration upsert must be executed using the environment-specific safe deployment process.
