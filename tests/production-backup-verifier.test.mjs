import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function shortHash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
}

async function fixture({ host = 'prod-db.example.com', database = 'toko360_prod', ageMinutes = 2 } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 't360-prod-backup-'));
  const artifact = join(dir, 'predeploy.dump');
  const bytes = Buffer.from('postgres-custom-backup-fixture');
  await writeFile(artifact, bytes);
  const metadata = join(dir, 'predeploy.dump.json');
  await writeFile(metadata, JSON.stringify({
    version: 1,
    createdAt: new Date(Date.now() - ageMinutes * 60000).toISOString(),
    artifact: 'predeploy.dump',
    size: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    source: {
      profile: 'postgresql',
      target: { profile: 'postgresql', hostHash: shortHash(host.toLowerCase()), databaseHash: shortHash(database) },
      consistency: 'pg_dump-custom',
    },
  }));
  return { dir, metadata };
}

function run(metadata, overrides = {}) {
  const env = {
    ...process.env,
    T360_PRODUCTION_BACKUP_CONFIRM: 'VERIFY_T360_PRODUCTION_BACKUP',
    T360_PRODUCTION_BACKUP_METADATA: metadata,
    T360_PRODUCTION_EXPECTED_DB_HOST: 'prod-db.example.com',
    T360_PRODUCTION_EXPECTED_DB_NAME: 'toko360_prod',
    T360_PRODUCTION_BACKUP_MAX_AGE_MINUTES: '120',
    ...overrides,
  };
  return spawnSync(process.execPath, ['scripts/verify-production-backup.mjs'], { cwd: process.cwd(), env, encoding: 'utf8' });
}

test('production backup verifier accepts fresh checksum-valid artifact from exact production DB identity', async () => {
  const { metadata } = await fixture();
  const result = run(metadata);
  assert.equal(result.status, 0, result.stderr);
  const evidence = JSON.parse(await readFile('handoff/quality/production-backup-latest.json', 'utf8'));
  assert.equal(evidence.status, 'PASS');
  assert.equal(evidence.productionTouched, false);
  assert.equal(evidence.databaseTarget.hostHash, shortHash('prod-db.example.com'));
  assert.equal(evidence.databaseTarget.databaseHash, shortHash('toko360_prod'));
  assert.equal(evidence.checks.some((row) => row.id === 'BACKUP_CHECKSUM_SIZE' && row.status === 'PASS'), true);
});

test('production backup verifier fails closed for wrong database target and overwrites latest evidence', async () => {
  const { metadata } = await fixture({ database: 'other_prod' });
  const result = run(metadata);
  assert.notEqual(result.status, 0);
  const evidence = JSON.parse(await readFile('handoff/quality/production-backup-latest.json', 'utf8'));
  assert.equal(evidence.status, 'FAIL');
  assert.equal(evidence.productionTouched, false);
  assert.match(evidence.error, /database yang berbeda/);
});

test('production backup verifier rejects stale backup', async () => {
  const { metadata } = await fixture({ ageMinutes: 180 });
  const result = run(metadata);
  assert.notEqual(result.status, 0);
  const evidence = JSON.parse(await readFile('handoff/quality/production-backup-latest.json', 'utf8'));
  assert.equal(evidence.status, 'FAIL');
  assert.match(evidence.error, /terlalu lama/);
});

test('canonical PostgreSQL backup metadata stores hashed target identity instead of raw DB host/user', async () => {
  const script = await readFile('scripts/backup-database.mjs', 'utf8');
  assert.match(script, /target: expectedPostgresTarget/);
  assert.match(script, /consistency: 'pg_dump-custom'/);
  assert.doesNotMatch(script, /source = \{ profile: 'postgresql', host:/);
  assert.doesNotMatch(script, /user: decodeURIComponent\(parsed\.username\)/);
});
