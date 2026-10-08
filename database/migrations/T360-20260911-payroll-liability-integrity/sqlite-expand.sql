-- T360 2026-09-11: payroll payment traceability for existing SQLite databases.
-- FinanceTransactionType is stored as TEXT in SQLite, so the new enum value requires no DDL.
ALTER TABLE "PayrollPayment" ADD COLUMN "settlementAccountCode" TEXT;
ALTER TABLE "PayrollPayment" ADD COLUMN "accountingEventId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "PayrollPayment_accountingEventId_key" ON "PayrollPayment"("accountingEventId");

-- Allow effective-dated payroll profiles. Prisma's previous single-field @unique
-- created these named unique indexes in existing SQLite databases.
DROP INDEX IF EXISTS "EmployeeTaxProfile_employeeId_key";
CREATE UNIQUE INDEX IF NOT EXISTS "EmployeeTaxProfile_employeeId_effectiveFrom_key" ON "EmployeeTaxProfile"("employeeId", "effectiveFrom");
CREATE INDEX IF NOT EXISTS "EmployeeTaxProfile_companyId_employeeId_effectiveFrom_idx" ON "EmployeeTaxProfile"("companyId", "employeeId", "effectiveFrom");
DROP INDEX IF EXISTS "EmployeeSocialSecurityProfile_employeeId_key";
CREATE UNIQUE INDEX IF NOT EXISTS "EmployeeSocialSecurityProfile_employeeId_effectiveFrom_key" ON "EmployeeSocialSecurityProfile"("employeeId", "effectiveFrom");
CREATE INDEX IF NOT EXISTS "EmployeeSocialSecurityProfile_companyId_employeeId_effectiveFrom_idx" ON "EmployeeSocialSecurityProfile"("companyId", "employeeId", "effectiveFrom");
