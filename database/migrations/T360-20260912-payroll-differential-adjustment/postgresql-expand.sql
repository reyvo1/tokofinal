-- T360 2026-09-12: differential payroll adjustment runs and employee recovery settlement.
-- Expand-only. Existing regular payroll runs/payments keep their previous semantics.
ALTER TABLE "PayrollRun" ADD COLUMN IF NOT EXISTS "adjustmentOfRunId" TEXT;
ALTER TABLE "PayrollRun" ADD COLUMN IF NOT EXISTS "adjustmentSequence" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PayrollRun" ADD COLUMN IF NOT EXISTS "adjustmentReason" TEXT;
ALTER TABLE "PayrollRun" ADD COLUMN IF NOT EXISTS "adjustmentPostingDate" TIMESTAMP(3);
CREATE UNIQUE INDEX IF NOT EXISTS "PayrollRun_companyId_branchId_adjustmentOfRunId_adjustmentSequence_key"
  ON "PayrollRun"("companyId", "branchId", "adjustmentOfRunId", "adjustmentSequence");

ALTER TABLE "PayrollPayment" ADD COLUMN IF NOT EXISTS "direction" TEXT NOT NULL DEFAULT 'OUTBOUND';
UPDATE "PayrollPayment" SET "direction"='OUTBOUND' WHERE "direction" IS NULL OR "direction"='';
