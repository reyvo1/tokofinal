import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const service = read('apps/api/src/accounting-core/accounting-core.service.ts');
const controller = read('apps/api/src/accounting-core/accounting-core.controller.ts');
const dto = read('apps/api/src/accounting-core/dto/accounting-core.dto.ts');
const admin = read('apps/admin/app/modules/tax-workspace.tsx');
const schema = read('apps/api/prisma/schema.prisma');
const sqlite = read('apps/api/prisma/schema.sqlite.prisma');
const postgres = read('apps/api/prisma/schema.postgresql.prisma');

for (const [name, source] of [['canonical', schema], ['sqlite', sqlite], ['postgres', postgres]]) {
  test(`F5 ${name} TaxCode is versioned and keeps historical transaction identity`, () => {
    assert.match(source, /model TaxCode \{[\s\S]*version\s+Int\s+@default\(1\)/);
    assert.match(source, /@@unique\(\[companyId, code, version\]\)/);
    assert.match(source, /model TaxTransaction \{[\s\S]*taxCodeId\s+String/);
  });
}

test('F5 tax configuration cannot rewrite active or used history', () => {
  assert.match(service, /taxTransaction\.count\(\{ where: \{ taxCodeId: existing\.id \} \}\)/);
  assert.match(service, /sudah menjadi histori\. Buat version baru/);
  assert.match(service, /yang sudah pernah ACTIVE\/INACTIVE tidak boleh kembali menjadi DRAFT/);
  assert.match(service, /memiliki periode efektif yang bertumpang tindih/);
  assert.match(service, /action: 'UPSERT_TAX_CODE'/);
});

test('F5 tax activation validates account mappings against active branch chart of accounts', () => {
  assert.match(service, /payableAccountCode[\s\S]*type: 'LIABILITY'/);
  assert.match(service, /receivableAccountCode[\s\S]*type: 'ASSET'/);
  assert.match(service, /expenseAccountCode[\s\S]*type: 'EXPENSE'/);
  assert.match(service, /branchId: scope\.branchId, branch: \{ companyId: scope\.companyId \}/);
});

test('F5 exposes tenant-scoped tax ledger documents and reconciliation APIs', () => {
  assert.match(controller, /@Get\('tax-transactions'\)/);
  assert.match(controller, /@Get\('tax-documents'\)/);
  assert.match(controller, /@Get\('tax-reconciliation'\)/);
  assert.match(service, /branchId: scope\.branchId, transactionDate: \{ gte: from, lte: to \}/);
  assert.match(service, /mappedAccountMovement/);
  assert.match(service, /missingAccountingEvent/);
  assert.match(service, /missingJournal/);
});

test('F5 DTO and controller expose explicit tax lifecycle rather than generic string status', () => {
  assert.match(dto, /class UpdateTaxCodeStatusDto/);
  assert.match(dto, /@IsIn\(\['DRAFT','ACTIVE','INACTIVE'\]\)/);
  assert.match(controller, /@Patch\('tax-codes\/:id\/status'\)/);
});

test('F5 Admin tax workspace manages version lifecycle and operational tax evidence', () => {
  assert.match(admin, /Versioned Tax Configuration/);
  assert.match(admin, /Buat v\+1/);
  assert.match(admin, /Tax Transactions/);
  assert.match(admin, /Tax Reconciliation/);
  assert.match(admin, /Mapped Account Movement/);
  assert.match(admin, /\/accounting-core\/tax-transactions/);
  assert.match(admin, /\/accounting-core\/tax-documents/);
  assert.match(admin, /\/accounting-core\/tax-reconciliation/);
});

test('F5 expand migrations preserve SQLite/PostgreSQL tax versioning parity', () => {
  const sq = read('database/migrations/T360-20260923-f5-tax-versioning/sqlite-expand.sql');
  const pg = read('database/migrations/T360-20260923-f5-tax-versioning/postgresql-expand.sql');
  for (const source of [sq, pg]) {
    assert.match(source, /ADD COLUMN.*version/i);
    assert.match(source, /TaxCode_companyId_code_version_key/);
  }
});
