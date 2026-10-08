-- T360 2026-09-11: asset/fleet reconciliation expand migration.
-- Adds supplier trace to fuel credit transactions so AP settlement can reference the original fuel document.
ALTER TABLE "FuelTransaction" ADD COLUMN IF NOT EXISTS "supplierId" TEXT;
CREATE INDEX IF NOT EXISTS "FuelTransaction_supplierId_transactionDate_idx" ON "FuelTransaction"("supplierId", "transactionDate");
