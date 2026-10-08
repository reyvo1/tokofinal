-- T360 2026-09-12: differential payroll adjustment runs and employee recovery settlement.
-- Apply exactly once to an existing SQLite database after backup verification.
ALTER TABLE "PayrollRun" ADD COLUMN "adjustmentOfRunId" TEXT;
ALTER TABLE "PayrollRun" ADD COLUMN "adjustmentSequence" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PayrollRun" ADD COLUMN "adjustmentReason" TEXT;
ALTER TABLE "PayrollRun" ADD COLUMN "adjustmentPostingDate" DATETIME;
CREATE UNIQUE INDEX IF NOT EXISTS "PayrollRun_companyId_branchId_adjustmentOfRunId_adjustmentSequence_key"
  ON "PayrollRun"("companyId", "branchId", "adjustmentOfRunId", "adjustmentSequence");

ALTER TABLE "PayrollPayment" ADD COLUMN "direction" TEXT NOT NULL DEFAULT 'OUTBOUND';
