import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(path, 'utf8');
const between = (source, start, end) => {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `missing start marker: ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing end marker: ${end}`);
  return source.slice(startAt, endAt);
};

test('maintenance part accounting context uses Prisma JSON-safe part details', () => {
  const source = read('apps/api/src/assets/assets.service.ts');
  assert.match(source, /const partDetails: Prisma\.InputJsonObject\[\] = \[\];/);
  assert.match(source, /batchId: part\.batchId \?\? null/);
});

test('distributed rate limit emits 429 without relying on a non-exported Nest exception', () => {
  const source = read('apps/api/src/auth/distributed-rate-limit.service.ts');
  assert.doesNotMatch(source, /TooManyRequestsException/);
  assert.match(source, /HttpStatus\.TOO_MANY_REQUESTS/);
  assert.match(source, /new HttpException\(/);
});

test('API bootstrap is typed as NestExpressApplication before useBodyParser', () => {
  const source = read('apps/api/src/main.ts');
  assert.match(source, /NestExpressApplication/);
  assert.match(source, /NestFactory\.create<NestExpressApplication>\(AppModule\)/);
  assert.match(source, /app\.useBodyParser\('json', \{ limit:/);
});

test('online-order accounting codes are a concrete string record', () => {
  const source = read('apps/api/src/orders/orders.service.ts');
  assert.match(source, /const accountCodes: Record<string, string> = prepaid/);
});

test('PayrollPayment settlement fields exist in every runtime Prisma schema', () => {
  for (const path of [
    'apps/api/prisma/schema.prisma',
    'apps/api/prisma/schema.sqlite.prisma',
    'apps/api/prisma/schema.postgresql.prisma',
  ]) {
    const model = between(read(path), 'model PayrollPayment {', '\nmodel PayrollAccountingMapping {');
    assert.match(model, /settlementAccountCode\s+String\?/);
    assert.match(model, /accountingEventId\s+String\?\s+@unique/);
  }
});

test('offline receipt payload uses an explicit unknown bridge for Prisma JSON input', () => {
  const source = read('apps/api/src/sales/sales.service.ts');
  assert.match(source, /payload: receiptPayload as unknown as Prisma\.InputJsonValue/);
});

test('payroll settlement persists fields exposed by the generated Prisma model', () => {
  const source = read('apps/api/src/payroll/payroll.service.ts');
  assert.match(source, /payment\.settlementAccountCode === dto\.settlementAccountCode/);
  assert.match(source, /settlementAccountCode: settlementAccount\.code/);
  assert.match(source, /accountingEventId: event\.id/);
});
