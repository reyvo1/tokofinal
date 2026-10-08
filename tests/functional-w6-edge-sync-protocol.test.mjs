import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = (p) => fs.readFileSync(p, 'utf8');
const service = read('apps/api/src/extensions/extensions.service.ts');
const controller = read('apps/api/src/extensions/extensions.controller.ts');
const sales = read('apps/api/src/sales/sales.service.ts');
const dto = read('apps/api/src/extensions/dto/extensions.dto.ts');
const schemas = ['apps/api/prisma/schema.prisma','apps/api/prisma/schema.sqlite.prisma','apps/api/prisma/schema.postgresql.prisma'].map(read);

test('W6 schemas include device credentials, sync receipts and offline dead-letter metadata', () => {
  for (const schema of schemas) {
    assert.match(schema, /model DeviceCredential \{/);
    assert.match(schema, /model SyncReceipt \{/);
    assert.match(schema, /DEAD_LETTER/);
    assert.match(schema, /attempts\s+Int\s+@default\(0\)/);
    assert.match(schema, /deadLetteredAt\s+DateTime\?/);
  }
});

test('device credential rotation stores only hash and returns one-time secret', () => {
  assert.match(dto, /class RotateDeviceCredentialDto/);
  assert.match(service, /randomBytes\(32\)\.toString\('base64url'\)/);
  assert.match(service, /createHash\('sha256'\)/);
  assert.match(service, /deviceCredential\.updateMany[\s\S]*status: 'REVOKED'/);
  assert.match(service, /secretHash/);
  assert.match(service, /Secret hanya ditampilkan sekali/);
});

test('sync pull optionally issues an idempotent device-scoped receipt and requires exact checkpoint acknowledgement', () => {
  assert.match(controller, /@Query\('deviceId'\) deviceId\?: string/);
  assert.match(service, /syncReceipt\.upsert/);
  assert.match(service, /deviceId_requestHash/);
  assert.match(service, /receiptId/);
  assert.match(controller, /devices\/:id\/sync\/ack/);
  assert.match(service, /checkpoint\.getTime\(\) !== checkpoint\.getTime\(\)/);
  assert.match(service, /status: 'ACKNOWLEDGED'/);
});

test('offline sales use bounded retry and dead-letter instead of infinite silent retries', () => {
  assert.match(sales, /attempts: \{ increment: 1 \}/);
  assert.match(sales, /const maxAttempts = 5/);
  assert.match(sales, /status: 'DEAD_LETTER'/);
  assert.match(sales, /deadLetteredAt/);
  assert.match(sales, /retryDelayMinutes/);
});

test('dead-letter requeue is explicit, permissioned and audited', () => {
  assert.match(controller, /offline-transactions\/:transactionId\/requeue/);
  assert.match(controller, /@Permissions\('integration\.manage'\)/);
  assert.match(service, /REQUEUE_OFFLINE_TRANSACTION/);
  assert.match(service, /\['FAILED','CONFLICT','DEAD_LETTER'\]/);
});
