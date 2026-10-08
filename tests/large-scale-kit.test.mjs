import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const postgres = readFileSync('apps/api/prisma/schema.postgresql.prisma', 'utf8');
const developmentKit = readFileSync('docs/DEVELOPMENT-KIT.md', 'utf8');

for (const file of [
  'docs/LARGE-SCALE-DATA.md',
  'docs/PERFORMANCE-CHECKLIST.md',
  'config/performance-budget.json',
  'scripts/load-test.mjs',
  'database/postgresql/large-scale/partitioning-template.sql',
]) {
  test(`large-scale artifact exists: ${file}`, () => assert.equal(existsSync(file), true));
}

test('development kit contains million-record architecture section', () => {
  assert.match(developmentKit, /## 37\. Arsitektur Data Skala Jutaan/);
  assert.match(developmentKit, /cursor pagination/i);
  assert.match(developmentKit, /partitioning/i);
  assert.match(developmentKit, /idempotency/i);
});

test('large-scale schema foundations exist', () => {
  for (const model of ['IdempotencyReceipt', 'DailySalesSummary', 'DailyFinanceSummary', 'DailyInventorySummary', 'ReportJob', 'DataRetentionPolicy', 'DataArchiveRun']) {
    assert.match(postgres, new RegExp(`model\\s+${model}\\s*\\{`));
  }
});

test('critical transaction indexes exist', () => {
  for (const index of [
    '@@index([branchId, createdAt])',
    '@@index([warehouseId, productId, createdAt])',
    '@@index([referenceType, referenceId])',
    '@@index([status, createdAt])',
  ]) assert.ok(postgres.includes(index), `missing ${index}`);
});

test('core large lists use pagination helpers', () => {
  for (const file of [
    'apps/api/src/products/products.service.ts',
    'apps/api/src/suppliers/suppliers.service.ts',
    'apps/api/src/inventory/inventory.service.ts',
    'apps/api/src/purchase-orders/purchase-orders.service.ts',
    'apps/api/src/goods-receipts/goods-receipts.service.ts',
    'apps/api/src/sales/sales.service.ts',
    'apps/api/src/orders/orders.service.ts',
  ]) {
    const source = readFileSync(file, 'utf8');
    assert.match(source, /parsePageLimit/);
    assert.match(source, /take:\s*limit \+ 1/);
    assert.match(source, /toCursorPage/);
  }
});
