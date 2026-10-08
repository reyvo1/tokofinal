-- T360 2026-09-11: asset/fleet reconciliation expand migration for SQLite.
ALTER TABLE "FuelTransaction" ADD COLUMN "supplierId" TEXT;
CREATE INDEX IF NOT EXISTS "FuelTransaction_supplierId_transactionDate_idx" ON "FuelTransaction"("supplierId", "transactionDate");
