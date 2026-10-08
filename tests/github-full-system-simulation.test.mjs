import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { renderGithubSimulationFiles, REQUIRED_UAT_IDS, validateGithubSimulationConfig } from '../scripts/ci-prepare-github-simulation.mjs';
import { scenarioCoverage } from '../scripts/ci-critical-uat-coverage.mjs';

const workflow = fs.readFileSync('.github/workflows/full-system-simulation.yml', 'utf8');
const stage19Prepare = fs.readFileSync('scripts/prepare-stage19-postgres.mjs', 'utf8');
const stage20Prepare = fs.readFileSync('scripts/prepare-stage20-postgres.mjs', 'utf8');
const stage19 = fs.readFileSync('scripts/run-tenant-http-db-integration.mjs', 'utf8');
const stage20 = fs.readFileSync('scripts/run-stage20-release-readiness.mjs', 'utf8');
const stage18 = fs.readFileSync('scripts/run-product-supplier-ownership-postgres-stage.mjs', 'utf8');
const buildGate = fs.readFileSync('scripts/run-build-gate.mjs', 'utf8');
const payrollRunner = fs.readFileSync('scripts/run-payroll-adjustment-postgres-stage.mjs', 'utf8');
const githubSummary = fs.readFileSync('scripts/ci-write-full-system-summary.mjs', 'utf8');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

const baseEnv = {
  T360_CI_DATABASE_URL: 'postgresql://toko360:secret@localhost:5432/toko360_staging?schema=public',
  T360_CI_EXPECTED_HOST: 'localhost',
  T360_CI_EXPECTED_DATABASE: 'toko360_staging',
  T360_CI_STAGE18_RESTORE_DATABASE: 'toko360_stage18_restore',
  T360_CI_DR_RESTORE_DATABASE: 'toko360_dr_restore',
  JWT_SECRET: 'x'.repeat(40), ORDER_ACCESS_SECRET: 'o'.repeat(40), SECRET_MASTER_KEY: 'a'.repeat(64), WEBHOOK_SIGNING_SECRET: 'w'.repeat(40),
  SEED_COMPANY_ID: '11111111-1111-4111-8111-111111111111',
  SEED_ADMIN_EMAIL: 'ci-admin@example.invalid', SEED_ADMIN_PASSWORD: 'CI-Only-Strong-Password-2026!',
};

test('GitHub simulation config is strictly non-production and target locked', () => {
  const config = validateGithubSimulationConfig(baseEnv);
  assert.equal(config.connection.database, 'toko360_staging');
  assert.throws(() => validateGithubSimulationConfig({ ...baseEnv, T360_CI_DATABASE_URL: 'postgresql://u:p@db.prod:5432/toko360_production', T360_CI_EXPECTED_HOST: 'db.prod', T360_CI_EXPECTED_DATABASE: 'toko360_production' }), /production\/live/);
  assert.throws(() => validateGithubSimulationConfig({ ...baseEnv, T360_CI_EXPECTED_DATABASE: 'other_staging' }), /expected host\/database/);
  assert.throws(() => validateGithubSimulationConfig({ ...baseEnv, T360_CI_DR_RESTORE_DATABASE: 'toko360_stage18_restore' }), /wajib database berbeda/);
});

test('GitHub simulation generates protected runtime and exactly 12 pending human UAT scenarios', () => {
  const files = renderGithubSimulationFiles(baseEnv);
  assert.match(files['.env'], /NODE_ENV=staging/);
  assert.match(files['.env'], /SEED_MODE=bootstrap/);
  assert.doesNotMatch(files['.env'], /Admin123!|Kasir123!|Employee123!/);
  const uat = JSON.parse(files['stage20-uat-ci-pending.json']);
  assert.equal(uat.environment, 'STAGING');
  assert.equal(uat.scenarios.length, 12);
  assert.deepEqual(uat.scenarios.map((item) => item.id), REQUIRED_UAT_IDS);
  assert.ok(uat.scenarios.every((item) => item.status === 'PENDING'));
  assert.equal(uat.releaseDecision, 'PENDING');
});

test('all 12 critical UAT scenarios map to concrete automated regression files', () => {
  assert.equal(Object.keys(scenarioCoverage).length, 12);
  for (const id of REQUIRED_UAT_IDS) {
    assert.ok(Array.isArray(scenarioCoverage[id]) && scenarioCoverage[id].length >= 2, `${id} coverage`);
    for (const file of scenarioCoverage[id]) assert.ok(fs.existsSync(`tests/${file}`), `${id}: ${file}`);
  }
});

test('GitHub full-system workflow runs exact-artifact PostgreSQL/browser/staging simulation on push', () => {
  assert.match(workflow, /on:[\s\S]*push:[\s\S]*branches: \[main, develop\]/);
  assert.match(workflow, /runs-on: ubuntu-24\.04/);
  assert.match(workflow, /postgres:16-alpine/);
  assert.match(workflow, /postgresql-client-16/);
  assert.match(workflow, /pg_dump --version/);
  assert.doesNotMatch(workflow, /redis:7-alpine|REDIS_URL/);
  assert.match(workflow, /npm run build:gate/);
  assert.match(buildGate, /SQLITE_DB_PREPARE/);
  assert.match(buildGate, /SQLITE_DB_SMOKE/);
  assert.match(buildGate, /PRISMA_GENERATE_POSTGRES_FINAL/);
  assert.doesNotMatch(workflow, /npm run db:local:prepare/);
  assert.match(workflow, /npm run test:db:smoke/);
  assert.match(workflow, /docker compose -f \.github\/ci\/docker-compose\.ci\.yml config/);
  assert.match(workflow, /npm run db:postgres:prepare:artifact/);
  assert.match(workflow, /npm run db:ownership:stage:postgres/);
  assert.match(workflow, /npm run db:payroll-adjustment:stage:postgres:artifact/);
  assert.match(workflow, /npm run test:tenant:staging:artifact/);
  assert.match(workflow, /npm run uat:browser:built/);
  assert.match(workflow, /npm run certify:staging/);
  assert.match(workflow, /setsid npm run start/);
  assert.match(workflow, /kill -TERM -- \"-\$pid\"/);
  assert.match(workflow, /scripts\/load-test\.mjs/);
  assert.match(workflow, /npm run db:dr:rehearse:postgres/);
  assert.match(workflow, /prepare-stage20-postgres\.mjs --env-file stage20-release-readiness\.env --preserve-artifact/);
  assert.match(workflow, /stage20-uat-ci-pending\.json/);
  assert.match(workflow, /human UAT pending/i);
  assert.match(workflow, /toko360-tested-runtime-/);
  assert.match(workflow, /include-hidden-files: true/);
  assert.match(workflow, /!apps\/admin\/\.next\/cache\/\*\*/);
  assert.match(workflow, /artifact-digest/);
  assert.match(workflow, /github-runtime-artifact-transport-latest\.json/);
  assert.match(workflow, /if-no-files-found: error/);
  assert.match(workflow, /ci:summary:github/);
  assert.match(workflow, /ci:summary:github:assert/);
  assert.match(workflow, /T360_CI_JOB_STATUS: \${{ job\.status }}/);
  assert.match(workflow, /continue-on-error: true/);
  assert.match(workflow, /steps\.artifact_preserved\.outcome == 'success'/);
  assert.match(workflow, /steps\.build_gate\.outcome == 'success'/);
  assert.match(githubSummary, /artifactTransport/);
  assert.match(workflow, /full-system-evidence/);
  assert.doesNotMatch(workflow, /production:smoke|production:ready:verify|verify-production-schema/);
});


test('GitHub summary is finalized only after immutable runtime artifact transport identity is recorded', () => {
  const transport = workflow.indexOf('Record immutable GitHub runtime artifact transport identity');
  const summary = workflow.indexOf('Write GitHub full-system summary evidence even on failure');
  const evidenceUpload = workflow.indexOf('Upload all simulation evidence and logs');
  const aggregate = workflow.indexOf('Assert aggregate GitHub simulation result');
  assert.ok(transport >= 0 && summary > transport, 'summary must run after transport identity');
  assert.ok(evidenceUpload > summary, 'evidence upload must include finalized summary');
  assert.ok(aggregate > evidenceUpload, 'aggregate assertion must fail only after evidence has been uploaded');
});


test('GitHub exact-artifact chain does not regenerate Prisma Client after build manifest creation', () => {
  assert.match(pkg.scripts['db:postgres:prepare:artifact'], /db:postgres:push:artifact/);
  assert.match(pkg.scripts['db:postgres:push:artifact'], /prisma:push:postgres:no-generate/);
  assert.match(payrollRunner, /--preserve-artifact/);
  assert.match(payrollRunner, /Prisma Client tidak digenerate ulang/);
  assert.match(stage20, /payrollMigration\.preserveBuildArtifact !== true/);
  assert.match(stage20, /payrollMigration\.buildArtifactId !== buildArtifact\.current\.id/);
  assert.doesNotMatch(workflow, /db:postgres:generate/);
});

test('Stage-19 and Stage-20 preparation preserve exact build artifact in release simulation', () => {
  for (const source of [stage19Prepare, stage20Prepare]) {
    assert.match(source, /--preserve-artifact/);
    assert.match(source, /readAndVerifyBuildArtifactManifest/);
  }
  assert.match(stage19Prepare, /tidak generate\/build ulang API/);
  assert.match(stage20Prepare, /tanpa generate\/build ulang/);
  assert.match(pkg.scripts['test:tenant:staging:artifact'], /--preserve-artifact/);
});

test('Stage-19 evidence refreshes Stage-18 current target and binds exact artifact into Stage-20', () => {
  assert.match(stage18, /stage18-postgres-staging\.json/);
  assert.match(stage18, /const currentSourceIdentity = sourceFingerprint\(root\)/);
  assert.match(stage18, /evidence invalidated at attempt start/);
  assert.match(stage19, /Evidence Tahap 18 berasal dari source fingerprint berbeda/);
  assert.match(stage19, /Stage-19 evidence invalidated at attempt start/);
  assert.match(stage20, /Stage-20 evidence invalidated at attempt start/);
  assert.match(stage19, /buildArtifactId: buildArtifact\.current\.id/);
  assert.match(stage19, /T360_BUILD_ARTIFACT_ID: buildArtifact\.current\.id/);
  assert.match(stage19, /Stage19 runtime build artifact mismatch/);
  assert.match(stage19, /readAndVerifyBuildArtifactManifest/);
  assert.match(stage20, /Evidence Tahap 19 belum membuktikan exact build artifact/);
  assert.match(stage20, /Evidence Tahap 19 berasal dari build artifact berbeda/);
});

test('GitHub automated Stage-20 is explicitly not allowed to replace human UAT candidate approval', () => {
  assert.match(workflow, /Expected Stage-20 exit 2/);
  assert.match(workflow, /UAT candidate verifier must not PASS from GitHub automated simulation alone/);
  assert.match(githubSummary, /humanUat: 'PENDING'/);
  assert.match(githubSummary, /UNEXPECTED_PASS/);
  assert.match(githubSummary, /Human Stage-20 UAT remains mandatory/);
});

test('GitHub exact runtime exports authored source fingerprint to all persistent services', () => {
  assert.match(workflow, /T360_SOURCE_FINGERPRINT=\$\{build\.sourceIdentityAfter\.value\}/);
  assert.match(workflow, /T360_EXPECTED_SOURCE_FINGERPRINT=\$\{build\.sourceIdentityAfter\.value\}/);
});
