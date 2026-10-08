import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const platform = readFileSync('apps/api/src/platform/platform.service.ts','utf8');
const worker = readFileSync('apps/worker/src/index.ts','utf8');
const schema = readFileSync('apps/api/prisma/schema.prisma','utf8');

test('approval requests carry branch scope and multi-step decisions', () => {
  assert.match(schema, /model ApprovalRequest[\s\S]*branchId\s+String\?/);
  assert.match(platform, /branchId: scope\.branchId, policyId: dto\.policyId/);
  assert.match(platform, /currentStep: \{ increment: 1 \}/);
  assert.match(platform, /requesterId === user\.sub/);
  assert.match(platform, /roles\.some\(\(role\) => user\.roles\.includes\(role\)\)/);
  assert.match(platform, /TransactionIsolationLevel\.Serializable/);
});

test('secret settings and webhook headers are redacted', () => {
  assert.match(platform, /REDACTED/);
  assert.match(platform, /headers: row\.headers \? \{ redacted: true \} : null/);
});

test('webhooks reject private targets at create time and worker delivery time', () => {
  assert.match(platform, /WEBHOOK_ALLOW_PRIVATE_TARGETS/);
  assert.match(platform, /Webhook ke localhost\/private network ditolak/);
  assert.match(worker, /assertSafeWebhookTarget/);
  assert.match(worker, /lookup\(url\.hostname, \{ all: true \}\)/);
  assert.match(worker, /privateIp\(entry\.address\)/);
});

test('notification delivery uses a lease claim before sending', () => {
  const claims = worker.match(/leaseUntil = new Date\(Date\.now\(\) \+ 5 \* 60 \* 1000\)/g) ?? [];
  assert.ok(claims.length >= 2);
  assert.match(worker, /updateMany\(\{ where: \{ id: notification\.id, status: 'QUEUED'/);
});

test('worker report boundary has only one dateOnly declaration', () => {
  const block = worker.match(/function reportBoundary[\s\S]*?function reportRange/)?.[0] ?? '';
  assert.equal((block.match(/const dateOnly/g) ?? []).length, 1);
});
