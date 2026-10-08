import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync('package.json','utf8'));
const health = fs.readFileSync('apps/api/src/app.controller.ts','utf8');
const runtimeTargetIdentity = fs.readFileSync('scripts/lib/runtime-target-identity.mjs','utf8');
const builtBrowser = fs.readFileSync('scripts/run-built-browser-uat.mjs','utf8');
const browser = fs.readFileSync('scripts/browser-uat.mjs','utf8');
const stage20 = fs.readFileSync('scripts/run-stage20-release-readiness.mjs','utf8');
const staging = fs.readFileSync('scripts/staging-certification.mjs','utf8');
const load = fs.readFileSync('scripts/load-test.mjs','utf8');
const indexes = fs.readFileSync('scripts/profile-postgres-indexes.mjs','utf8');
const dr = fs.readFileSync('scripts/run-postgres-dr-drill.mjs','utf8');
const promotion = fs.readFileSync('scripts/verify-production-promotion.mjs','utf8');
const smoke = fs.readFileSync('scripts/production-smoke.mjs','utf8');
const ready = fs.readFileSync('scripts/verify-production-ready.mjs','utf8');

 test('runtime health exposes non-secret deployed source identity', () => {
  assert.match(health, /sourceFingerprint: process\.env\.T360_SOURCE_FINGERPRINT/);
  assert.match(health, /buildId: process\.env\.T360_BUILD_ID/);
  assert.match(health, /databaseTarget: runtimeDatabaseIdentity\(\)/);
  assert.match(health, /hostHash: parsed\.hostname \? shortHash\(parsed\.hostname\.toLowerCase\(\)\)/);
  assert.match(runtimeTargetIdentity, /expectedPostgresTarget/);
  assert.match(runtimeTargetIdentity, /assertRuntimeDatabaseTarget/);
  assert.match(builtBrowser, /T360_SOURCE_FINGERPRINT: evidence\.sourceIdentityBefore\.value/);
  assert.match(browser, /Runtime source fingerprint tidak cocok/);
  assert.match(stage20, /T360_SOURCE_FINGERPRINT: currentSourceIdentity\.value/);
  assert.match(stage20, /sample\.body\?\.release\?\.sourceFingerprint !== currentSourceIdentity\.value/);
});

test('staging/load/index evidence is source and target attributable', () => {
  assert.match(staging, /STAGING_EXPECTED_SOURCE_FINGERPRINT/);
  assert.match(staging, /sourceIdentity/);
  assert.match(staging, /STAGING_EXPECTED_DB_HOST/);
  assert.match(staging, /STAGING_EXPECTED_DB_NAME/);
  assert.match(staging, /assertRuntimeDatabaseTarget/);
  assert.match(staging, /databaseTarget: expectedDatabaseTarget/);
  assert.match(load, /sourceIdentity: sourceFingerprint/);
  assert.match(load, /load-health-latest\.json/);
  assert.match(load, /expected-source-fingerprint/);
  assert.match(load, /expected-db-host/);
  assert.match(load, /expected-db-name/);
  assert.match(load, /runtimeSourceFingerprint/);
  assert.match(load, /runtimeDatabaseTarget/);
  assert.match(indexes, /postgres-index-profile-latest\.json/);
  assert.match(indexes, /databaseHash/);
});

test('PostgreSQL DR rehearsal is non-production, isolated, checksum verified and smoke tested', () => {
  assert.equal(pkg.scripts['db:dr:rehearse:postgres'], 'node scripts/run-postgres-dr-drill.mjs');
  assert.match(dr, /RUN_T360_POSTGRES_DR_NON_PRODUCTION/);
  assert.match(dr, /menolak target production\/live/);
  assert.match(dr, /Database restore scratch wajib berbeda/);
  assert.match(dr, /verify-backup\.mjs/);
  assert.match(dr, /restore-backup\.mjs/);
  assert.match(dr, /test:db:smoke/);
  assert.match(dr, /postgres-dr-drill-latest\.json/);
});

test('promotion verifier requires UAT, Stage-20, runtime certification, load, index, DR and human approval', () => {
  assert.equal(pkg.scripts['production:promotion:verify'], 'node scripts/verify-production-promotion.mjs');
  for (const marker of ['UAT_CANDIDATE','STAGE20','STAGING_CERTIFICATION','LOAD_CAPACITY','INDEX_PROFILE','POSTGRES_DR_DRILL','HUMAN_PROMOTION_APPROVAL']) assert.match(promotion, new RegExp(marker));
  assert.match(promotion, /promotionReady: status === 'PASS'/);
  assert.match(promotion, /productionReady: false/);
  assert.match(promotion, /approvalAt < Math\.max/);
  assert.match(promotion, /DR drill source database berbeda dengan Stage-20/);
  assert.match(promotion, /Staging certification berasal dari database runtime berbeda dengan Stage-20/);
  assert.match(promotion, /Load evidence tidak membuktikan runtime source fingerprint/);
  assert.match(promotion, /Load evidence berasal dari runtime database berbeda dengan Stage-20/);
});

test('production smoke requires HTTPS, explicit confirmation, exact deployed fingerprint and security headers', () => {
  assert.equal(pkg.scripts['production:smoke'], 'node scripts/production-smoke.mjs');
  assert.match(smoke, /RUN_T360_PRODUCTION_SMOKE/);
  assert.match(smoke, /Production smoke wajib menggunakan HTTPS/);
  assert.match(smoke, /T360_PRODUCTION_EXPECTED_SOURCE_FINGERPRINT/);
  assert.match(smoke, /T360_PRODUCTION_EXPECTED_DB_HOST/);
  assert.match(smoke, /T360_PRODUCTION_EXPECTED_DB_NAME/);
  assert.match(smoke, /assertRuntimeDatabaseTarget/);
  assert.match(smoke, /strict-transport-security/);
  assert.match(smoke, /PRODUCTION_FINANCIAL_INTEGRITY/);
  assert.match(smoke, /businessMutationsPerformed: false/);
  assert.match(smoke, /kredensial tidak dikirim ke target ini/);
  assert.match(smoke, /let productionTouched = false/);
});

test('final production-ready verifier requires promotion, deployed smoke and post-smoke attestation', () => {
  assert.equal(pkg.scripts['production:ready:verify'], 'node scripts/verify-production-ready.mjs');
  assert.match(ready, /PRODUCTION_PROMOTION/);
  assert.match(ready, /PRODUCTION_SMOKE/);
  assert.match(ready, /DEPLOYMENT_ATTESTATION/);
  assert.match(ready, /Production smoke lebih lama daripada promotion approval/);
  assert.match(ready, /Deployment approval harus dilakukan setelah production smoke terbaru/);
  assert.match(ready, /Deployment attestation database target berbeda dengan production smoke/);
  assert.match(ready, /productionReady: status === 'PASS'/);
});

test('operator approval files are examples only and actual local attestations are ignored', () => {
  const ignore = fs.readFileSync('.gitignore','utf8');
  assert.match(ignore, /^production-promotion-approval\.json$/m);
  assert.match(ignore, /^production-deployment-attestation\.json$/m);
  const promotionExample = JSON.parse(fs.readFileSync('config/production-promotion-approval.json.example','utf8'));
  const deploymentExample = JSON.parse(fs.readFileSync('config/production-deployment-attestation.json.example','utf8'));
  assert.equal(promotionExample.decision, 'GO_FOR_PRODUCTION_PROMOTION');
  assert.equal(deploymentExample.decision, 'PRODUCTION_DEPLOYMENT_VERIFIED');
});

test('production readiness documentation no longer claims implemented API-key auth is missing', () => {
  const finalDoc = fs.readFileSync('docs/FINAL-PRODUCTION-READINESS.md','utf8');
  const apiKeys = fs.readFileSync('apps/api/src/auth/api-keys.service.ts','utf8');
  assert.match(apiKeys, /ROTATE_API_KEY/);
  assert.match(apiKeys, /REVOKE_API_KEY/);
  assert.doesNotMatch(finalDoc, /schema exists but it is not exposed as an authentication path/i);
  assert.match(finalDoc, /scoped API-key create\/authenticate\/rotate\/revoke/);
});

test('runtime database target helper hashes only non-secret PostgreSQL identity', async () => {
  const { expectedPostgresTarget, assertRuntimeDatabaseTarget } = await import('../scripts/lib/runtime-target-identity.mjs');
  const expected = expectedPostgresTarget('DB-STAGING.EXAMPLE.COM', 'toko360_stage');
  assert.equal(expected.profile, 'postgresql');
  assert.equal(expected.hostHash.length, 16);
  assert.equal(expected.databaseHash.length, 16);
  assert.equal(assertRuntimeDatabaseTarget({ ...expected }, expected), true);
  assert.throws(() => assertRuntimeDatabaseTarget({ ...expected, databaseHash: '0000000000000000' }, expected), /berbeda/);
});

test('production backup is machine-verified and bound to final production-ready gate', () => {
  const productionBackup = fs.readFileSync('scripts/verify-production-backup.mjs','utf8');
  assert.equal(pkg.scripts['production:backup:verify'], 'node scripts/verify-production-backup.mjs');
  assert.match(productionBackup, /VERIFY_T360_PRODUCTION_BACKUP/);
  assert.match(productionBackup, /T360_PRODUCTION_BACKUP_METADATA/);
  assert.match(productionBackup, /T360_PRODUCTION_EXPECTED_DB_HOST/);
  assert.match(productionBackup, /T360_PRODUCTION_EXPECTED_DB_NAME/);
  assert.match(productionBackup, /BACKUP_CHECKSUM_SIZE/);
  assert.match(productionBackup, /BACKUP_FRESHNESS/);
  assert.match(productionBackup, /productionTouched: false/);
  assert.match(ready, /PRODUCTION_BACKUP/);
  assert.match(ready, /Production backup berasal dari database berbeda dengan production smoke/);
  assert.match(ready, /Pre-deploy production backup dibuat sebelum promotion gate PASS/);
  assert.match(ready, /Pre-deploy production backup harus sudah diverifikasi sebelum production smoke/);
});
