import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const schemas = ['apps/api/prisma/schema.prisma','apps/api/prisma/schema.sqlite.prisma','apps/api/prisma/schema.postgresql.prisma'].map(read);
const service = read('apps/api/src/returns/returns.service.ts');
const controller = read('apps/api/src/returns/returns.controller.ts');
const publicController = read('apps/api/src/returns/storefront-order-returns.controller.ts');
const ops = read('apps/api/src/operations-control/operations-control.service.ts');
const admin = read('apps/admin/app/modules/operations.tsx');
const opsAdmin = read('apps/admin/app/modules/operations-control.tsx');
const storefront = read('apps/storefront/app/page.tsx');
const seed = read('apps/api/prisma/seed.ts');
const reports = read('apps/api/src/reports/reports.service.ts');

for (const [index, schema] of schemas.entries()) {
  test(`OrderReturn models exist in schema ${index + 1}`, () => {
    assert.match(schema, /model OrderReturn \{/);
    assert.match(schema, /model OrderReturnItem \{/);
    assert.match(schema, /orderItemId\s+String/);
    assert.match(schema, /accountingEventId\s+String\?\s+@unique/);
  });
}

test('customer return request is account-owned and cumulative-quantity guarded', () => {
  assert.match(service, /storefrontCustomers\.authenticate\(branchCode, token\)/);
  assert.match(service, /customerId: identity\.customerId/);
  assert.match(service, /status: 'COMPLETED'/);
  assert.match(service, /alreadyReturned/);
  assert.match(service, /used \+ requestedQty > original\.quantity/);
  assert.match(service, /CUSTOMER_ORDER_RETURN_REQUESTED/);
});

test('staff workflow requires operational inspection before refund posting', () => {
  assert.match(service, /startOrderReturnInspection/);
  assert.match(service, /sourceType: 'OrderReturn'/);
  assert.match(service, /ORDER_RETURN_ITEM:/);
  assert.match(service, /inspection\.status !== 'APPROVED'/);
  assert.match(service, /CONFIRM_ORDER_RETURN/);
  assert.match(service, /eventType: 'ORDER_RETURN'/);
});

test('refund posts inventory/accounting/tax reversal and only marks full order refunded when cumulative quantities are complete', () => {
  assert.match(service, /type: 'SALE_RETURN'/);
  assert.match(service, /taxableBase: item\.netAmount\.negated\(\)/);
  assert.match(service, /taxAmount: item\.taxAmount\.negated\(\)/);
  assert.match(service, /const fullOrderReturn = orderItems\.every/);
  assert.match(service, /status: 'REFUNDED'/);
  assert.match(seed, /code: 'ORDER-RETURN', eventType: 'ORDER_RETURN'/);
  assert.match(reports, /'ORDER_RETURN'/);
});


test('order returns reuse the SALE_RETURN inventory movement enum while preserving ORDER_RETURN accounting identity', () => {
  for (const schema of schemas) {
    const block = schema.match(/enum InventoryMovementType \{([\s\S]*?)\n\}/)?.[1] || '';
    assert.match(block, /\bSALE_RETURN\b/);
    assert.doesNotMatch(block, /\bORDER_RETURN\b/);
  }
  assert.match(service, /type: 'SALE_RETURN'/);
  assert.match(service, /eventType: 'ORDER_RETURN'/);
});

test('public and staff routes expose the lifecycle without Postman-only gaps', () => {
  assert.match(publicController, /@Controller\('storefront\/account\/returns'\)/);
  assert.match(publicController, /@Post\(\)/);
  assert.match(controller, /@Get\('orders'\)/);
  assert.match(controller, /@Post\('orders\/:id\/inspection'\)/);
  assert.match(controller, /@Post\('orders\/:id\/reject'\)/);
  assert.match(controller, /@Post\('orders\/:id\/confirm'\)/);
});

test('operations control supports OrderReturn source and barcode inspection', () => {
  assert.match(ops, /sourceType === 'SaleReturn' \|\| sourceType === 'OrderReturn'/);
  assert.match(ops, /case 'OrderReturn'/);
  assert.match(ops, /inspection\.sourceType === 'OrderReturn'/);
  assert.match(ops, /Barcode\/SKU tidak termasuk dalam retur order ini/);
  assert.match(opsAdmin, /'OrderReturn'/);
  assert.match(opsAdmin, /PASS · layak restock/);
});

test('storefront and admin expose return request and staff processing', () => {
  assert.match(storefront, /storefront\/account\/returns/);
  assert.match(storefront, /Ajukan retur/);
  assert.match(storefront, /Riwayat retur/);
  assert.match(admin, /Retur Pesanan Storefront/);
  assert.match(admin, /Mulai inspeksi/);
  assert.match(admin, /Posting refund/);
});

test('expand migration exists for SQLite and PostgreSQL', () => {
  const sqlite = read('database/migrations/T360-20260911-storefront-order-return/sqlite-expand.sql');
  const postgres = read('database/migrations/T360-20260911-storefront-order-return/postgresql-expand.sql');
  for (const sql of [sqlite, postgres]) {
    assert.match(sql, /CREATE TABLE IF NOT EXISTS "OrderReturn"/);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS "OrderReturnItem"/);
    assert.match(sql, /OrderReturn_accountingEventId_key/);
  }
});
