import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('local candidate TS: tax workspace never-branch is removed', () => {
  const source = read('apps/admin/app/modules/tax-workspace.tsx');
  assert.match(source, /row\.taxCode \? `\$\{row\.taxCode\.code\} v\$\{row\.taxCode\.version\}/);
  assert.doesNotMatch(source, /: row\.taxCode\?\.name/);
});

test('local candidate TS: seed uses current category and tax compound keys', () => {
  const source = read('apps/api/prisma/seed.ts');
  assert.match(source, /companyId_slug:\s*\{\s*companyId:\s*company\.id,\s*slug:\s*'produk-umum'/);
  assert.match(source, /companyId_code_version:\s*\{\s*companyId:\s*company\.id,\s*code:\s*item\.code,\s*version:\s*1/);
  const taxSeed = source.slice(source.indexOf('const taxCodes = ['), source.indexOf('const postingRules:'));
  assert.doesNotMatch(taxSeed, /companyId_code:\s*\{/);
});

test('local candidate TS: accounting tenant guard narrows nullable rows to never', () => {
  const source = read('apps/api/src/accounting-core/accounting-core.service.ts');
  for (const entity of ['Account', 'AccountingEvent', 'TaxCode', 'AccountingPostingRule']) {
    assert.match(source, new RegExp(`\\?\\? \\(await this\\.denyTenantAccess\\([^\\n]+['\"]${entity}['\"]`));
  }
});

test('local candidate TS: extension audit supports aggregate actions without entity id', () => {
  const source = read('apps/api/src/extensions/extensions.service.ts');
  assert.match(source, /entityId\?: string,/);
  assert.match(source, /'REFRESH_OPERATOR_INSIGHTS', 'OperatorInsight', undefined,/);
});

test('local candidate TS: AP aging preserves typed outstanding amount', () => {
  const source = read('apps/api/src/finance-operations/finance-operations.service.ts');
  assert.match(source, /outstandingAmount:\s*String\(row\.outstandingAmount \?\? 0\)/);
  assert.doesNotMatch(source, /summarizeAging\(rows as Array</);
});

test('local candidate TS: purchase prepared items are explicitly typed', () => {
  const source = read('apps/api/src/purchase-orders/purchase-orders.service.ts');
  assert.match(source, /const preparedItems: Array<\{/);
  assert.match(source, /purchaseUnitCost: Prisma\.Decimal; subtotal: Prisma\.Decimal;/);
});

test('local candidate TS: sales prepared item type includes variant and product unit identity', () => {
  const source = read('apps/api/src/sales/sales.service.ts');
  assert.match(source, /productId: string; variantId: string \| null; productUnitId: string \| null; quantity: number;/);
});
