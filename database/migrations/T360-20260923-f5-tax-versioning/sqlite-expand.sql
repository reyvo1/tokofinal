ALTER TABLE "TaxCode" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
DROP INDEX IF EXISTS "TaxCode_companyId_code_key";
CREATE UNIQUE INDEX IF NOT EXISTS "TaxCode_companyId_code_version_key" ON "TaxCode"("companyId", "code", "version");
CREATE INDEX IF NOT EXISTS "TaxCode_companyId_code_status_effectiveFrom_idx" ON "TaxCode"("companyId", "code", "status", "effectiveFrom");
