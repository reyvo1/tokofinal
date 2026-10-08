import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('GitHub manual full UAT uses bootstrap-safe credentials rather than demo credentials', () => {
  const workflow = read('.github/workflows/toko360-full-uat.yml');
  assert.match(workflow, /SEED_ADMIN_PASSWORD:\s*CI-Only-Strong-Password-2026!/);
  assert.match(workflow, /T360_UAT_ADMIN_PASSWORD:\s*CI-Only-Strong-Password-2026!/);
  assert.doesNotMatch(workflow, /Admin123!|Employee123!/);
});

test('GitHub UAT env preparation preserves workflow bootstrap credentials and derives restore identity', () => {
  const script = read('scripts/prepare-github-uat-env.mjs');
  assert.match(script, /process\.env\.SEED_ADMIN_PASSWORD \|\| process\.env\.T360_UAT_ADMIN_PASSWORD/);
  assert.match(script, /restoreBuilder = new URL\(primaryUrl\)/);
  assert.match(script, /restoreBuilder\.pathname = `\/\$\{restoreDatabase\}`/);
  assert.match(script, /T360_STAGE18_EXPECTED_RESTORE_HOST: restore\.hostname/);
  assert.match(script, /T360_STAGE18_EXPECTED_RESTORE_DATABASE: decodeURIComponent\(restore\.pathname\.slice\(1\)\)/);
  assert.doesNotMatch(script, /SEED_ADMIN_PASSWORD:\s*'Admin123!'/);
  assert.doesNotMatch(script, /postgresql:\/\/postgres:toko360_ci_password@localhost:5432\/toko360_stage18_restore/);
  assert.match(script, /SEED_COMPANY_ID: '11111111-1111-4111-8111-111111111111'/);
  assert.doesNotMatch(script, /00000000-0000-0000-0000-000000000001/);
});

test('build gate isolates SQLite compatibility seed from PostgreSQL bootstrap env', () => {
  const buildGate = read('scripts/run-build-gate.mjs');
  assert.match(buildGate, /DATABASE_PROFILE: 'sqlite', DATABASE_URL: 'file:\.\/data\/build-gate\.db', SEED_MODE: 'demo', NODE_ENV: 'test'/);
  assert.match(buildGate, /db:local:prepare/);
  assert.match(buildGate, /test:db:smoke/);
});


test('GitHub full UAT treats candidate lock as a strict negative assertion, not an ignored failure', () => {
  const workflow = read('.github/workflows/toko360-full-uat.yml');
  const report = read('scripts/github-uat-report.mjs');

  assert.match(workflow, /Prove UAT candidate remains fail-closed only because human Stage-20 is pending/);
  assert.doesNotMatch(
    workflow,
    /- name: Prove UAT candidate remains fail-closed only because human Stage-20 is pending[\s\S]*?continue-on-error:\s*true/,
  );
  assert.match(workflow, /UAT candidate verifier must not PASS from GitHub automated simulation alone/);
  assert.match(workflow, /item\.id !== 'STAGE20' && item\.status !== 'PASS'/);
  assert.match(workflow, /stage20\.reason !== 'Gate evidence belum PASS\.'/);
  assert.match(workflow, /STEP_CANDIDATE: \$\{\{ steps\.candidate\.outcome \}\}/);
  assert.match(workflow, /check "UAT candidate fail-closed assertion" "\$STEP_CANDIDATE"/);
  assert.match(report, /UAT candidate fail-closed assertion/);
});
