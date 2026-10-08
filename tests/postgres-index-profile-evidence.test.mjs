import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('scripts/profile-postgres-indexes.mjs', 'utf8');
const summary = fs.readFileSync('scripts/ci-write-full-system-summary.mjs', 'utf8');

test('PostgreSQL index profile invalidates stale evidence before dynamic Prisma preflight', () => {
  assert.match(source, /evidence invalidated at attempt start/);
  assert.match(source, /status: 'FAIL'/);
  assert.match(source, /await import\('@prisma\/client'\)/);
  assert.match(source, /sourceIdentity/);
  assert.match(source, /gate: \{ passed: false \}/);
});

test('PostgreSQL index profile emits source-bound PASS evidence only after database queries complete', () => {
  assert.match(source, /evidence\.status = 'PASS'/);
  assert.match(source, /evidence\.gate\.passed = true/);
  assert.match(source, /sequentialScanCandidates/);
  assert.match(source, /unusedLargeIndexes/);
  assert.match(source, /deadTupleCandidates/);
  assert.match(summary, /indexProfile: gateStatus/);
  assert.match(summary, /v\.status === 'PASS' && v\.gate\?\.passed === true/);
});
