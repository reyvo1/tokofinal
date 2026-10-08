import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const controller = read('apps/api/src/accounting-core/accounting-core.controller.ts');
const service = read('apps/api/src/accounting-core/accounting-core.service.ts');
const dto = read('apps/api/src/accounting-core/dto/accounting-core.dto.ts');
const admin = read('apps/admin/app/modules/accounting.tsx');

test('F4 chart of accounts has tenant-scoped operator lifecycle with history safety', () => {
  assert.match(controller, /@Post\('accounts'\)/);
  assert.match(controller, /@Patch\('accounts\/:id'\)/);
  assert.match(service, /branchId: scope\.branchId, branch: \{ companyId: scope\.companyId \}/);
  assert.match(service, /Tipe akun yang sudah memiliki histori jurnal tidak boleh diubah/);
  assert.match(service, /masih dipakai posting rule ACTIVE/);
  assert.match(admin, /Tambah akun/);
  assert.match(admin, /Nonaktifkan/);
});

test('F4 posting rule versions cannot rewrite accounting history', () => {
  assert.match(service, /postingCount = await tx\.accountingPosting\.count/);
  assert.match(service, /sudah menjadi histori\. Buat version baru/);
  assert.match(service, /action: 'UPSERT_ACCOUNTING_POSTING_RULE'/);
  assert.match(service, /operation: existing \? 'UPDATE_DRAFT_VERSION' : 'CREATE_VERSION'/);
  assert.match(service, /Rule yang sudah pernah ACTIVE\/INACTIVE tidak boleh kembali menjadi DRAFT/);
  assert.match(admin, /Buat v\{rule\.version \+ 1\}/);
});

test('F4 posting rule activation validates mapping, balance shape and effective overlap', () => {
  assert.match(dto, /class UpdatePostingRuleStatusDto/);
  assert.match(service, /minimal satu baris DEBIT dan satu baris CREDIT/);
  assert.match(service, /tepat satu accountCode atau accountCodeKey/);
  assert.match(service, /Akun posting rule belum aktif\/tersedia pada branch ini/);
  assert.match(service, /bertumpang tindih untuk eventType\/priority yang sama/);
  assert.match(controller, /@Patch\('posting-rules\/:id\/status'\)/);
});

test('F4 accounting event drill-down binds source rule journal and account lines', () => {
  assert.match(controller, /@Get\('events\/:id'\)/);
  assert.match(service, /async getEventDetail/);
  assert.match(service, /companyId: scope\.companyId, branchId: scope\.branchId/);
  assert.match(service, /accountingPostingRule\.findMany/);
  assert.match(service, /journalEntry\.findFirst/);
  assert.match(service, /include: \{ lines: \{ include: \{ account:/);
  assert.match(admin, /ACCOUNTING DRILL-DOWN/);
  assert.match(admin, /Drill-down/);
});

test('F4 operator manages posting-rule account mapping instead of read-only list', () => {
  assert.match(admin, /Versioned Account Mapping/);
  assert.match(admin, /Journal mapping/);
  assert.match(admin, /\/accounting-core\/posting-rules/);
  assert.match(admin, /\/accounting-core\/posting-rules\/\$\{rule\.id\}\/status/);
  assert.match(admin, /Rule yang pernah ACTIVE atau sudah dipakai posting tidak dapat ditimpa/);
});
