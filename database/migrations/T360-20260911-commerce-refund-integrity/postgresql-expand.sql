-- T360 2026-09-11: supplier credit-note/refund tracking for existing PostgreSQL databases.
ALTER TYPE "FinanceTransactionType" ADD VALUE IF NOT EXISTS 'SUPPLIER_REFUND';
ALTER TABLE "PurchaseReturn" ADD COLUMN IF NOT EXISTS "payableOffsetAmount" DECIMAL(18,2) NOT NULL DEFAULT 0;
ALTER TABLE "PurchaseReturn" ADD COLUMN IF NOT EXISTS "supplierReceivableAmount" DECIMAL(18,2) NOT NULL DEFAULT 0;
ALTER TABLE "PurchaseReturn" ADD COLUMN IF NOT EXISTS "supplierCreditNoteNumber" TEXT;
