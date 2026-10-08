-- T360 2026-09-11: supplier credit-note/refund tracking for existing SQLite databases.
ALTER TABLE "PurchaseReturn" ADD COLUMN "payableOffsetAmount" DECIMAL NOT NULL DEFAULT 0;
ALTER TABLE "PurchaseReturn" ADD COLUMN "supplierReceivableAmount" DECIMAL NOT NULL DEFAULT 0;
ALTER TABLE "PurchaseReturn" ADD COLUMN "supplierCreditNoteNumber" TEXT;
-- SQLite stores Prisma enum values as TEXT, so SUPPLIER_REFUND needs no enum DDL.
