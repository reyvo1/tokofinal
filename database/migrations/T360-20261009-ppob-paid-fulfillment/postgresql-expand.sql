-- Additive only: legacy unpaid PPOB rows remain readable and cannot be dispatched.
ALTER TABLE "DigitalServiceTransaction" ADD COLUMN "cashierShiftId" TEXT;
ALTER TABLE "DigitalServiceTransaction" ADD COLUMN "paymentAccountingEventId" TEXT;
ALTER TABLE "DigitalServiceTransaction" ADD COLUMN "settlementAccountingEventId" TEXT;
ALTER TABLE "DigitalServiceTransaction" ADD COLUMN "refundAccountingEventId" TEXT;
ALTER TABLE "DigitalServiceTransaction" ADD COLUMN "refundCashierShiftId" TEXT;
ALTER TABLE "DigitalServiceTransaction" ADD COLUMN "capturedAt" TIMESTAMP(3);
ALTER TABLE "DigitalServiceTransaction" ADD COLUMN "settledAt" TIMESTAMP(3);
ALTER TABLE "DigitalServiceTransaction" ADD COLUMN "refundedAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "DigitalServiceTransaction_companyId_branchId_cashierShiftId_capturedAt_idx" ON "DigitalServiceTransaction"("companyId", "branchId", "cashierShiftId", "capturedAt");
CREATE INDEX IF NOT EXISTS "DigitalServiceTransaction_companyId_branchId_refundCashierShiftId_refundedAt_idx" ON "DigitalServiceTransaction"("companyId", "branchId", "refundCashierShiftId", "refundedAt");
