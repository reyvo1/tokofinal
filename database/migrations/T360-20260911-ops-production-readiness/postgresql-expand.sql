ALTER TABLE "ApprovalRequest" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
CREATE INDEX IF NOT EXISTS "ApprovalRequest_companyId_branchId_status_idx" ON "ApprovalRequest"("companyId", "branchId", "status");
UPDATE "ApprovalRequest" ar
SET "branchId" = u."branchId"
FROM "User" u
WHERE ar."branchId" IS NULL AND ar."requesterId" = u."id";
