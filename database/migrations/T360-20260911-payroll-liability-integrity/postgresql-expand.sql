-- T360 2026-09-11: payroll payment traceability and run-scoped payroll-liability settlement.
ALTER TYPE "FinanceTransactionType" ADD VALUE IF NOT EXISTS 'PAYROLL_LIABILITY_PAYMENT';
ALTER TABLE "PayrollPayment" ADD COLUMN IF NOT EXISTS "settlementAccountCode" TEXT;
ALTER TABLE "PayrollPayment" ADD COLUMN IF NOT EXISTS "accountingEventId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "PayrollPayment_accountingEventId_key" ON "PayrollPayment"("accountingEventId");

-- Allow effective-dated payroll profiles. The former employee-only unique constraint
-- prevented profile history even though the runtime selects profiles by effective date.
ALTER TABLE "EmployeeTaxProfile" DROP CONSTRAINT IF EXISTS "EmployeeTaxProfile_employeeId_key";
CREATE UNIQUE INDEX IF NOT EXISTS "EmployeeTaxProfile_employeeId_effectiveFrom_key" ON "EmployeeTaxProfile"("employeeId", "effectiveFrom");
CREATE INDEX IF NOT EXISTS "EmployeeTaxProfile_companyId_employeeId_effectiveFrom_idx" ON "EmployeeTaxProfile"("companyId", "employeeId", "effectiveFrom");
ALTER TABLE "EmployeeSocialSecurityProfile" DROP CONSTRAINT IF EXISTS "EmployeeSocialSecurityProfile_employeeId_key";
CREATE UNIQUE INDEX IF NOT EXISTS "EmployeeSocialSecurityProfile_employeeId_effectiveFrom_key" ON "EmployeeSocialSecurityProfile"("employeeId", "effectiveFrom");
CREATE INDEX IF NOT EXISTS "EmployeeSocialSecurityProfile_companyId_employeeId_effectiveFrom_idx" ON "EmployeeSocialSecurityProfile"("companyId", "employeeId", "effectiveFrom");
