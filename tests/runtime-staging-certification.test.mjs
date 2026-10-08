import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const auth = readFileSync('apps/api/src/auth/auth.service.ts','utf8');
const guard = readFileSync('apps/api/src/auth/jwt-auth.guard.ts','utf8');
const limiter = readFileSync('apps/api/src/auth/distributed-rate-limit.service.ts','utf8');
const platform = readFileSync('apps/api/src/platform/platform.service.ts','utf8');
const secretProtector = readFileSync('apps/api/src/platform/secret-protector.service.ts','utf8');
const worker = readFileSync('apps/worker/src/index.ts','utf8');
const restore = readFileSync('scripts/restore-backup.mjs','utf8');
const load = readFileSync('scripts/load-test.mjs','utf8');
const staging = readFileSync('scripts/staging-certification.mjs','utf8');
const authModule = readFileSync('apps/api/src/auth/auth.module.ts','utf8');
const main = readFileSync('apps/api/src/main.ts','utf8');
const envPostgres = readFileSync('.env.postgres.example','utf8');
const stage20 = readFileSync('scripts/run-stage20-release-readiness.mjs','utf8');

for (const file of ['apps/api/prisma/schema.prisma','apps/api/prisma/schema.sqlite.prisma','apps/api/prisma/schema.postgresql.prisma']) {
  test(`${file} contains revocable auth sessions and shared rate-limit buckets`, () => {
    const schema = readFileSync(file,'utf8');
    assert.match(schema, /model AuthSession[\s\S]*revokedAt\s+DateTime\?/);
    assert.match(schema, /@@index\(\[userId, revokedAt, expiresAt\]\)/);
    assert.match(schema, /model RateLimitBucket[\s\S]*@@unique\(\[scope, keyHash\]\)/);
  });
}

test('JWT login creates a server session and logout revokes it', () => {
  assert.match(auth, /const sid = randomUUID\(\)/);
  assert.match(auth, /tx\.authSession\.create/);
  assert.match(auth, /revokeReason: 'LOGOUT'/);
  assert.match(auth, /revokeReason: 'LOGOUT_ALL'/);
  assert.match(guard, /Sesi token tidak terdaftar/);
  assert.match(guard, /sessions: \{ where: \{ id: tokenUser\.sid, revokedAt: null/);
  assert.match(guard, /Sesi sudah dicabut atau kedaluwarsa/);
});

test('login throttle is database-backed and concurrency-aware rather than process-local', () => {
  assert.match(limiter, /rateLimitBucket\.findUnique/);
  assert.match(limiter, /TransactionIsolationLevel\.Serializable/);
  assert.match(limiter, /updateMany/);
  assert.match(limiter, /P2002/);
  assert.match(limiter, /P2034/);
  assert.match(auth, /auth-login-email/);
  assert.match(auth, /auth-login-ip/);
  assert.doesNotMatch(auth, /new Map/);
});

test('platform secrets are encrypted at rest and only redacted values are returned', () => {
  assert.match(secretProtector, /aes-256-gcm/);
  assert.match(secretProtector, /SECRET_MASTER_KEY/);
  assert.match(secretProtector, /__toko360Encrypted/);
  assert.match(platform, /this\.secrets\.encryptJson\(dto\.value\)/);
  assert.match(platform, /this\.secrets\.encryptText\(dto\.encryptedSecrets\)/);
  assert.match(platform, /this\.secrets\.encryptJson\(dto\.headers\)/);
  assert.match(platform, /value: '\*\*\*REDACTED\*\*\*'/);
});

test('webhook and outbox workers use leases and webhook delivery carries protected stable idempotency headers', () => {
  assert.match(worker, /status: 'PROCESSING', nextRetryAt: \{ lte: now \}/);
  assert.match(worker, /data: \{ status: 'PROCESSING', nextRetryAt: leaseUntil \}/);
  assert.match(worker, /'idempotency-key': delivery\.id/);
  assert.match(worker, /RESERVED_WEBHOOK_HEADERS/);
  assert.match(worker, /RESERVED_WEBHOOK_HEADERS\.has\(key\.toLowerCase\(\)\)/);
  assert.match(worker, /assertNoReservedWebhookHeaders\(configuredHeaders\)/);
  assert.match(worker, /OR: \[\{ status: 'PENDING' \}, \{ status: 'PROCESSING' \}\]/);
  assert.match(worker, /availableAt: leaseUntil/);
});

test('reserved webhook headers are case-insensitive because Fetch normalizes duplicate names', () => {
  const headers = new Headers({
    'idempotency-key': 'delivery-123',
    'x-toko360-signature': 'sha256=trusted',
    'Idempotency-Key': 'ATTACKER',
    'X-Toko360-Signature': 'sha256=attacker',
  });
  assert.match(headers.get('idempotency-key') ?? '', /ATTACKER/, 'proof fixture: mixed-case duplicate would contaminate the idempotency key');
  assert.match(headers.get('x-toko360-signature') ?? '', /attacker/, 'proof fixture: mixed-case duplicate would contaminate the signature');
});

test('restore rehearsal is fail-closed for production and verifies checksum before mutation', () => {
  assert.match(restore, /development','test','staging/);
  assert.match(restore, /Production ditolak/);
  assert.match(restore, /Target restore tidak boleh sama dengan DATABASE_URL aktif/);
  assert.match(restore, /Checksum\/size backup tidak valid; restore dibatalkan/);
  assert.match(restore, /shell: false/);
});

test('load and staging certification emit machine-verifiable pass/fail evidence', () => {
  assert.match(load, /max-p95-ms/);
  assert.match(load, /max-error-rate/);
  assert.match(load, /thresholds:/);
  assert.match(staging, /login-and-session-registry/);
  assert.match(staging, /financial-integrity/);
  assert.match(staging, /logout-revokes-session/);
  assert.match(staging, /STAGING_EXPECTED_DB_HOST/);
  assert.match(staging, /STAGING_EXPECTED_DB_NAME/);
  assert.match(staging, /assertRuntimeDatabaseTarget/);
  assert.match(staging, /after\.response\.status !== 401/);
});


test('staging certification overwrites latest evidence with FAIL on preflight error', () => {
  const dir = mkdtempSync(join(tmpdir(), 't360-staging-cert-'));
  const output = join(dir, 'latest.json');
  try {
    const result = spawnSync(process.execPath, ['scripts/staging-certification.mjs'], { encoding: 'utf8', env: { ...process.env, STAGING_CERT_OUTPUT: output, STAGING_BASE_URL: '' } });
    assert.equal(result.status, 2);
    assert.equal(existsSync(output), true);
    const evidence = JSON.parse(readFileSync(output, 'utf8'));
    assert.equal(evidence.passed, false);
    assert.equal(evidence.checks[0]?.name, 'preflight');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('load runtime identity failure overwrites latest evidence with FAIL', () => {
  const dir = mkdtempSync(join(tmpdir(), 't360-load-cert-'));
  const output = join(dir, 'latest.json');
  try {
    const result = spawnSync(process.execPath, ['scripts/load-test.mjs', '--url', 'http://127.0.0.1:9/api/v1/health', '--requests', '1', '--concurrency', '1', '--timeout-ms', '100', '--expected-source-fingerprint', 'a'.repeat(64), '--output', output], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.equal(existsSync(output), true);
    const evidence = JSON.parse(readFileSync(output, 'utf8'));
    assert.equal(evidence.preflight?.status, 'FAIL');
    assert.equal(evidence.thresholds?.passed, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('load runtime identity lock rejects incomplete database target before any request can run', () => {
  const result = spawnSync(process.execPath, ['scripts/load-test.mjs', '--requests', '1', '--concurrency', '1', '--expected-db-host', 'db-stage.example.com'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /wajib diisi bersama/);
  assert.equal(result.stdout, '');
});

test('load test rejects invalid numeric thresholds before any request can run', () => {
  for (const args of [
    ['--max-p95-ms', 'NOT_A_NUMBER'],
    ['--max-p99-ms', '-1'],
    ['--max-error-rate', '1.1'],
    ['--min-rps', 'NaN'],
    ['--timeout-ms', '99'],
  ]) {
    const result = spawnSync(process.execPath, ['scripts/load-test.mjs', '--requests', '1', '--concurrency', '1', ...args], { encoding: 'utf8' });
    assert.equal(result.status, 1, `${args.join(' ')} harus fail-closed`);
    assert.match(result.stderr, /tidak valid/);
    assert.equal(result.stdout, '');
  }
});

test('staging and production share protected runtime secret and CORS guards', () => {
  assert.match(authModule, /environment === 'production' \|\| environment === 'staging'/);
  assert.match(authModule, /bukan placeholder/);
  assert.match(secretProtector, /staging\/production wajib dikonfigurasi sebagai key 32-byte/);
  assert.match(main, /CORS_ORIGINS wajib dikonfigurasi pada staging\/production/);
  assert.match(main, /tidak boleh wildcard/);
  assert.match(worker, /protectedEnvironment && !secretMasterKey/);
  assert.match(worker, /WEBHOOK_SIGNING_SECRET staging\/production wajib unik/);
  assert.match(stage20, /SECRET_MASTER_KEY: crypto\.randomBytes\(32\)\.toString\('hex'\)/);
  assert.match(stage20, /CORS_ORIGINS: 'http:\/\/127\.0\.0\.1:3000'/);
  assert.match(envPostgres, /^JWT_SECRET=\s*$/m);
  assert.match(envPostgres, /^ORDER_ACCESS_SECRET=\s*$/m);
  assert.match(envPostgres, /^CORS_ORIGINS=\s*$/m);
  assert.match(envPostgres, /^WEBHOOK_SIGNING_SECRET=\s*$/m);
});

test('existing database migration creates session and rate-limit storage for both providers', () => {
  const pg = readFileSync('database/migrations/T360-20260911-runtime-staging-certification/postgresql-expand.sql','utf8');
  const sqlite = readFileSync('database/migrations/T360-20260911-runtime-staging-certification/sqlite-expand.sql','utf8');
  for (const sql of [pg, sqlite]) {
    assert.match(sql, /CREATE TABLE IF NOT EXISTS "AuthSession"/);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS "RateLimitBucket"/);
    assert.match(sql, /RateLimitBucket_scope_keyHash_key/);
  }
});

test('PostgreSQL index profiler is evidence-only and never mutates indexes', () => {
  const profiler = readFileSync('scripts/profile-postgres-indexes.mjs','utf8');
  assert.match(profiler, /pg_stat_user_tables/);
  assert.match(profiler, /pg_stat_user_indexes/);
  assert.match(profiler, /EXPLAIN \(ANALYZE, BUFFERS\)/);
  assert.doesNotMatch(profiler, /CREATE INDEX|DROP INDEX/i);
});
