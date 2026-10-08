import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { parsePostgresUrl, publicEvidence, validateNonProductionConfig } from '../scripts/run-tenant-http-db-integration.mjs';

const valid = {
  T360_STAGE19_TARGET: 'STAGING',
  T360_STAGE19_CONFIRM: 'RUN_T360_STAGE19_NON_PRODUCTION',
  T360_STAGE19_DATABASE_URL: 'postgresql://user:secret@stage.internal:5432/toko360_staging?sslmode=require',
  T360_STAGE19_EXPECTED_HOST: 'stage.internal',
  T360_STAGE19_EXPECTED_DATABASE: 'toko360_staging',
  T360_STAGE19_API_PORT: '41919',
};

test('stage19 config accepts exact staging identity and dedicated API port', () => {
  const value = validateNonProductionConfig(valid);
  assert.equal(value.target, 'STAGING');
  assert.equal(value.connection.database, 'toko360_staging');
  assert.equal(value.apiPort, 41919);
});

test('stage19 config rejects production markers, identity mismatch, and normal app ports', () => {
  assert.throws(() => validateNonProductionConfig({ ...valid, T360_STAGE19_DATABASE_URL: 'postgresql://u:p@db:5432/toko360_production', T360_STAGE19_EXPECTED_HOST: 'db', T360_STAGE19_EXPECTED_DATABASE: 'toko360_production' }), /production\/live/);
  assert.throws(() => validateNonProductionConfig({ ...valid, T360_STAGE19_EXPECTED_HOST: 'other.internal' }), /Host target tidak cocok/);
  assert.throws(() => validateNonProductionConfig({ ...valid, T360_STAGE19_API_PORT: '4000' }), /port integrasi khusus/);
});

test('postgres URL parser does not expose password in identity result', () => {
  const parsed = parsePostgresUrl('postgresql://alice:p%40ss@stage.example:6432/toko360_staging?sslmode=require');
  assert.deepEqual(parsed, { hostname: 'stage.example', port: '6432', database: 'toko360_staging', username: 'alice' });
});

test('public evidence excludes credential token and raw URL fields', () => {
  const evidence = publicEvidence({ generatedAt: 'x', targetMode: 'STAGING', target: {}, fixtureRunId: 'r', apiPort: 41919, tests: [], summary: {}, auditDenials: 1, cleanup: {}, gate: {}, password: 'secret', token: 'jwt', databaseUrl: 'postgresql://secret' });
  const text = JSON.stringify(evidence);
  assert.doesNotMatch(text, /postgresql:\/\/|jwt|secret/);
});

test('runner covers required HTTP DB tenant domains and cleanup', () => {
  const source = fs.readFileSync(new URL('../scripts/run-tenant-http-db-integration.mjs', import.meta.url), 'utf8');
  for (const marker of ['/products', '/inventory', '/accounting-core/events', '/accounting-core/tax-codes', '/payroll/runs', '/finance-operations', '/orders/', '/users', '/offline-transactions']) assert.match(source, new RegExp(marker.replaceAll('/', '\\/')));
  assert.match(source, /TENANT_ACCESS_DENIED/);
  assert.match(source, /cleanupPassed/);
  assert.match(source, /stage18-postgres-staging\.json/);
  assert.doesNotMatch(source, /DROP DATABASE|TRUNCATE/i);
});


test('stage19 evidence is bound to source fingerprint and refreshes official evidence', () => {
  const source = fs.readFileSync(new URL('../scripts/run-tenant-http-db-integration.mjs', import.meta.url), 'utf8');
  assert.match(source, /const currentSourceIdentity = sourceFingerprint\(root\)/);
  assert.match(source, /sourceIdentity: currentSourceIdentity/);
  assert.match(source, /buildArtifactId: buildArtifact\.current\.id/);
  assert.match(source, /officialEvidenceDir/);
  assert.match(source, /stage19-http-db-integration\.json/);
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.match(pkg.scripts['test:tenant:staging'], /prepare-stage19-postgres\.mjs/);
  assert.match(pkg.scripts['test:tenant:staging'], /run-tenant-http-db-integration\.mjs/);
});

test('Stage-19 public-order fixture provisions real tenant-local courier fulfillment and reports HTTP error bodies', () => {
  const source = fs.readFileSync(new URL('../scripts/run-tenant-http-db-integration.mjs', import.meta.url), 'utf8');
  assert.match(source, /type: 'COURIER'/);
  assert.match(source, /fulfillmentType: 'DELIVERY'/);
  assert.match(source, /masterReferenceIds/);
  assert.match(source, /prisma\.masterReference\.deleteMany/);
  assert.match(source, /response=\$\{String\(detail\)\.slice/);
});
