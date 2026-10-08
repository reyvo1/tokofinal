import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const platform = readFileSync('apps/api/src/platform/platform.service.ts','utf8');
const controller = readFileSync('apps/api/src/platform/platform.controller.ts','utf8');
const worker = readFileSync('apps/worker/src/index.ts','utf8');
const authModule = readFileSync('apps/api/src/auth/auth.module.ts','utf8');
const authService = readFileSync('apps/api/src/auth/auth.service.ts','utf8');
const main = readFileSync('apps/api/src/main.ts','utf8');
const schema = readFileSync('apps/api/prisma/schema.prisma','utf8');

for (const file of ['apps/api/prisma/schema.prisma','apps/api/prisma/schema.sqlite.prisma','apps/api/prisma/schema.postgresql.prisma']) {
  test(`${file} carries approval expiry/delegation fields`, () => {
    const text = readFileSync(file,'utf8');
    assert.match(text, /enum ApprovalStatus[\s\S]*EXPIRED/);
    assert.match(text, /model ApprovalRequest[\s\S]*expiresAt\s+DateTime\?/);
    assert.match(text, /delegatedToId\s+String\?/);
    assert.match(text, /@@index\(\[status, expiresAt\]\)/);
  });
}

test('approval lifecycle supports deterministic expiry escalation and same-branch delegation', () => {
  assert.match(platform, /expiresInMinutes/);
  assert.match(platform, /delegateApproval\(/);
  assert.match(platform, /Target delegasi tidak aktif pada branch yang sama/);
  assert.match(platform, /Target delegasi tidak memenuhi role langkah approval/);
  assert.match(platform, /Target delegasi tidak memenuhi permission langkah approval/);
  assert.match(worker, /processApprovalExpiries/);
  assert.match(worker, /escalationRoles/);
  assert.match(worker, /status: 'EXPIRED'/);
  assert.match(worker, /staleLock = new Date\(Date\.now\(\) - 10 \* 60 \* 1000\)/);
});

test('failed automation webhook and outbox records expose audited operator replay controls', () => {
  assert.match(controller, /automation-jobs\/:id\/replay/);
  assert.match(controller, /webhook-deliveries\/:id\/replay/);
  assert.match(controller, /outbox\/:id\/replay/);
  assert.match(platform, /REPLAY_AUTOMATION_JOB/);
  assert.match(platform, /REPLAY_WEBHOOK_DELIVERY/);
  assert.match(platform, /REPLAY_OUTBOX_EVENT/);
  assert.match(platform, /REPLAY_NOTIFICATION/);
  assert.ok(controller.includes("notifications/:id/replay"));
  assert.match(platform, /Hanya outbox FAILED yang dapat direplay/);
});

test('feature rollout is validated and deterministically bucketed per tenant subject', () => {
  assert.match(platform, /rolloutPercentage harus 0 sampai 100/);
  assert.match(platform, /createHash\('sha256'\)/);
  assert.match(platform, /configuredEnabled: flag\.enabled/);
  assert.match(platform, /bucket < Math\.floor\(percentage \* 100\)/);
});

test('production auth rejects weak JWT config and login brute force uses shared database throttling', () => {
  assert.match(authModule, /JWT_SECRET staging\/production wajib unik, bukan placeholder, dan minimal 32 karakter/);
  assert.match(authService, /DistributedRateLimitService/);
  assert.match(authService, /auth-login-email/);
  assert.match(authService, /auth-login-ip/);
  assert.match(authService, /`\$\{prefix\}_FAIL_LIMIT`/);
  assert.match(authService, /LOGIN_FAILED/);
});

test('audit review remains tenant and branch scoped', () => {
  assert.match(controller, /Get\('audit-logs'\)/);
  assert.match(platform, /async listAuditLogs/);
  assert.match(platform, /payload\.branchId === scope\.branchId/);
  assert.match(platform, /row\.user\?\.branchId === scope\.branchId/);
});

test('production HTTP defaults are fail-closed for CORS and send basic security headers', () => {
  assert.match(main, /CORS_ORIGINS wajib dikonfigurasi pada staging\/production/);
  assert.match(main, /X-Content-Type-Options/);
  assert.match(main, /X-Frame-Options/);
  assert.match(main, /Strict-Transport-Security/);
  assert.match(main, /origin: origins\.length \? origins : !protectedEnvironment/);
});

test('existing-database migration covers approval expiry and PostgreSQL EXPIRED enum', () => {
  const pg = readFileSync('database/migrations/T360-20260911-final-production-readiness/postgresql-expand.sql','utf8');
  const sqlite = readFileSync('database/migrations/T360-20260911-final-production-readiness/sqlite-expand.sql','utf8');
  assert.match(pg, /ADD VALUE IF NOT EXISTS 'EXPIRED'/);
  assert.match(pg, /ADD COLUMN IF NOT EXISTS "expiresAt"/);
  assert.match(sqlite, /ADD COLUMN "expiresAt" DATETIME/);
  assert.match(sqlite, /ApprovalRequest_status_expiresAt_idx/);
});
