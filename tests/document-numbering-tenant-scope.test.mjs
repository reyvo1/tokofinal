import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(path, 'utf8');
const numbering = read('apps/api/src/common/numbering.ts');
const schemas = [
  'apps/api/prisma/schema.prisma',
  'apps/api/prisma/schema.sqlite.prisma',
  'apps/api/prisma/schema.postgresql.prisma',
].map(read);

test('tenant-scoped sequence emits a tenant-scoped user-facing number', () => {
  assert.match(numbering, /resolveDocumentScopeCode\(tx, opts\.companyId, opts\.branchId\)/);
  assert.match(numbering, /where: \{ id: branchId, companyId \}/);
  assert.match(numbering, /return branch\.code/);
  assert.match(numbering, /company\.slug\?\.trim\(\) \|\| companyId/);
  assert.match(numbering, /`\$\{prefix\}-\$\{scopeCode\}-\$\{yyyy\}\$\{mm\}-\$\{String\(seq\)\.padStart\(padding, '0'\)\}`/);
});

test('numbering contract prevents tenant-local sequence values from colliding with global document uniqueness', () => {
  for (const schema of schemas) {
    assert.match(schema, /model NumberSequence \{[\s\S]*@@unique\(\[companyId, branchId, documentType\]\)/);
    assert.match(schema, /model Order \{[\s\S]*?number\s+String\s+@unique/);
    assert.match(schema, /model Sale \{[\s\S]*?number\s+String\s+@unique/);
    assert.match(schema, /model Payment \{[\s\S]*?number\s+String\s+@unique/);
    assert.match(schema, /model JournalEntry \{[\s\S]*?number\s+String\s+@unique/);
  }
});

test('branch scope is validated against company before a document number is emitted', () => {
  assert.match(numbering, /tx\.branch\.findFirst\(\{[\s\S]*where: \{ id: branchId, companyId \}/);
  assert.match(numbering, /Branch nomor dokumen tidak ditemukan pada company yang diminta/);
});
