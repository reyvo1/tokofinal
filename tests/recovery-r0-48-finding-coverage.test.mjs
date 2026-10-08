import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const matrix = JSON.parse(read('config/recovery-finding-matrix.json'));
const r0 = JSON.parse(read('work-items/completed/T360-20260924-020700-recovery-r0-truth-reset.json'));
const r1 = JSON.parse(read('work-items/completed/T360-20260924-022400-recovery-r1-tenant-access-control-plane.json'));
const r2 = JSON.parse(read('work-items/completed/T360-20260924-180000-recovery-r2-hr-attendance-payroll.json'));
const f12 = JSON.parse(read('work-items/active/T360-20260923-221011-full-ui-tailwind-and-github-uat-expansion.json'));
const pkg = JSON.parse(read('package.json'));
const projectState = read('docs/PROJECT-STATE.md');
const workflow = read('docs/TOKO360-MASTER-RECOVERY-WORKFLOW.md');

test('R0 maps all 48 findings exactly once with no unmapped rows', () => {
  assert.equal(matrix.findingCount, 48);
  assert.equal(matrix.unmappedFindingCount, 0);
  assert.equal(matrix.findings.length, 48);
  assert.equal(new Set(matrix.findings.map((item) => item.id)).size, 48);
  for (let i = 1; i <= 48; i += 1) assert.ok(matrix.findings.some((item) => item.id === `F${String(i).padStart(2, '0')}`));
});

test('R0-R8 recovery dependency chain is canonical', () => {
  assert.deepEqual(matrix.waves.map((wave) => wave.id), ['R0','R1','R2','R3','R4','R5','R6','R7','R8']);
  const r7 = matrix.waves.find((wave) => wave.id === 'R7');
  const r8 = matrix.waves.find((wave) => wave.id === 'R8');
  assert.deepEqual(r7.dependsOn, ['R1','R2','R3','R4','R5','R6']);
  assert.deepEqual(r8.dependsOn, ['R1','R2','R3','R4','R5','R6','R7']);
});

test('critical and high findings cannot silently lose runtime evidence requirement', () => {
  for (const finding of matrix.findings.filter((item) => ['CRITICAL','HIGH'].includes(item.severity))) {
    assert.equal(finding.runtimeEvidenceRequired, true, finding.id);
  }
});

test('R0-R6 prerequisites are closed and R7 UI verification is active', () => {
  assert.equal(r0.phase, 'CLOSED');
  assert.equal(r0.wave, 'W0');
  assert.equal(r1.phase, 'CLOSED');
  assert.equal(r1.wave, 'W0');
  assert.equal(r1.closureEvidence?.commit, 'abac92662cab4cc7352de4f9f9d2e2419aad9c29');
  assert.equal(r2.phase, 'CLOSED');
  assert.equal(r2.wave, 'W4');
  assert.ok(r2.dependencies.includes(r1.id));
  assert.equal(f12.phase, 'VERIFICATION');
  assert.ok(f12.dependencies.includes(r1.id));
  assert.match(projectState, /Recovery R0/);
  assert.match(projectState, /Recovery R1/);
  assert.match(projectState, /Recovery R2/);
  assert.match(workflow, /48\/48/);
});

test('recovery audit is an executable package gate', () => {
  assert.equal(pkg.scripts['audit:recovery'], 'node scripts/audit-recovery-coverage.mjs');
});
