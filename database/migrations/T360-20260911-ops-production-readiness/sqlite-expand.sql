ALTER TABLE "ApprovalRequest" ADD COLUMN "branchId" TEXT;
CREATE INDEX IF NOT EXISTS "ApprovalRequest_companyId_branchId_status_idx" ON "ApprovalRequest"("companyId", "branchId", "status");
UPDATE "ApprovalRequest"
SET "branchId" = (SELECT "branchId" FROM "User" WHERE "User"."id" = "ApprovalRequest"."requesterId")
WHERE "branchId" IS NULL AND "requesterId" IS NOT NULL;
