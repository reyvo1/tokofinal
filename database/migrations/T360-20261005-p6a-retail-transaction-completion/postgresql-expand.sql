ALTER TABLE "Payment" ADD COLUMN "methodName" TEXT;
ALTER TABLE "Payment" ADD COLUMN "methodReferenceId" TEXT;
ALTER TABLE "Payment" ADD COLUMN "methodSnapshot" JSONB;
ALTER TABLE "Payment" ADD COLUMN "settlementAccountCode" TEXT;
ALTER TABLE "Payment" ADD COLUMN "settlementBehavior" TEXT;
ALTER TABLE "Payment" ADD COLUMN "feeAmount" DECIMAL(18,2) NOT NULL DEFAULT 0;
ALTER TABLE "Payment" ADD COLUMN "feeAccountCode" TEXT;
ALTER TABLE "SaleReturn" ADD COLUMN "refundDetails" JSONB;
