CREATE TABLE "StaffMemo" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "companyId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "operationKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "isPinned" BOOLEAN NOT NULL DEFAULT false,
  "archivedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "StaffMemo_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "StaffMemo_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "StaffMemo_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "StaffMemo_userId_branchId_operationKey_key" ON "StaffMemo"("userId", "branchId", "operationKey");
CREATE INDEX "StaffMemo_companyId_branchId_userId_archivedAt_isPinned_updatedAt_idx" ON "StaffMemo"("companyId", "branchId", "userId", "archivedAt", "isPinned", "updatedAt");
