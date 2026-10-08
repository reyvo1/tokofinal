import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root,p),'utf8');
const matrix = JSON.parse(read('config/product-completeness.json'));

test('P0 establishes one canonical product completeness authority', () => {
  assert.equal(matrix.authoritative, true);
  assert.equal(matrix.policy.canonicalStatusSource, 'config/product-completeness.json');
  assert.equal(matrix.productReady, false);
  assert.equal(matrix.humanStage20, 'PENDING');
  assert.ok(matrix.features.length >= 30);
  assert.equal(matrix.legacyFunctionalPhases.length, 12);
  assert.equal(matrix.postAuditFindings.length, 15);
});

test('P0 forbids marker-only closure and requires human UI acceptance', () => {
  assert.equal(matrix.policy.sourceMarkersCannotClose, true);
  assert.equal(matrix.policy.runtimeEvidenceRequiredForCriticalHigh, true);
  assert.equal(matrix.policy.humanAcceptanceRequiredForUiClosure, true);
  for (const finding of matrix.postAuditFindings.filter((x) => ['CRITICAL','HIGH'].includes(x.severity))) {
    if (['RUNTIME_VERIFIED','HUMAN_ACCEPTED'].includes(finding.status)) assert.ok(finding.evidence?.length);
  }
});

test('P0 removes credentials and excludes generated evidence from active tracked source', () => {
  const auditSource = read('scripts/audit-product-completeness.mjs');
  assert.match(auditSource, /git',[\s\S]*'ls-files'/);
  assert.match(auditSource, /file === 'payroll-adjustment-postgres-stage\.env'/);
  const ignore = read('.gitignore');
  assert.match(ignore, /payroll-adjustment-postgres-stage\.env/);
  assert.match(ignore, /\*\.recovery-backup/);
  assert.match(ignore, /handoff\/quality\/\*\.json/);
  assert.match(ignore, /logs\/payroll-adjustment-postgres-stage\//);
  assert.match(ignore, /logs\/stage20-release-readiness\//);
  assert.match(read('scripts/audit-product-completeness.mjs'), /Generated\/credential artifact must not be tracked/);
});

test('legacy status documents defer to canonical matrix', () => {
  for (const p of ['docs/PROJECT-STATE.md','STATUS-FINAL.md','docs/FUNCTIONAL-DEPTH-ROADMAP.md','docs/FEATURE-CATALOG.md']) {
    assert.match(read(p), /config\/product-completeness\.json/, p);
  }
  assert.equal(JSON.parse(read('config/functional-depth-roadmap.json')).statusAuthority, 'config/product-completeness.json');
  assert.equal(JSON.parse(read('config/recovery-finding-matrix.json')).statusAuthority, 'config/product-completeness.json');
});

test('full repository audit includes canonical product-completeness audit', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.match(pkg.scripts['audit:full:repo'], /audit:product:completeness/);
});
