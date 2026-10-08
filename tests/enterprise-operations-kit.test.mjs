import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');

for (const path of [
  'docs/ENTERPRISE-ACCOUNTING-TAX.md',
  'docs/ASSET-FLEET-OPERATIONS.md',
  'docs/INBOUND-OUTBOUND-CONTROL.md',
  'docs/AUTOMATION-RULEBOOK.md',
  'apps/api/src/accounting-core/accounting-core.service.ts',
  'apps/api/src/finance-operations/finance-operations.service.ts',
  'apps/api/src/assets/assets.service.ts',
  'apps/api/src/fleet/fleet.service.ts',
  'apps/api/src/operations-control/operations-control.service.ts',
  'apps/api/src/returns/returns.service.ts',
]) test(`enterprise artifact exists: ${path}`, () => assert.equal(existsSync(path), true));

test('development kit contains enterprise sections 39-42', () => {
  const kit = read('docs/DEVELOPMENT-KIT.md');
  for (const title of ['## 39. Akuntansi dan Perpajakan Seluruh Sistem','## 40. Manajemen Aset dan Armada','## 41. Pemeriksaan Barang Masuk dan Keluar','## 42. Otomatisasi Fleksibel dan Dinamis']) assert.match(kit, new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('enterprise Prisma models exist in both profiles', () => {
  for (const schema of ['apps/api/prisma/schema.prisma','apps/api/prisma/schema.sqlite.prisma']) {
    const text = read(schema);
    for (const model of ['AccountingEvent','AccountingPostingRule','TaxCode','TaxTransaction','OperationalFinanceTransaction','Asset','Vehicle','DeliveryTrip','OperationalInspection','GatePass','OperationPolicy','AutomationJob']) assert.match(text, new RegExp(`model ${model} \\{`));
  }
});

test('all major operational modules use accounting core', () => {
  for (const path of [
    'apps/api/src/sales/sales.service.ts','apps/api/src/orders/orders.service.ts','apps/api/src/goods-receipts/goods-receipts.service.ts',
    'apps/api/src/payroll/payroll.service.ts','apps/api/src/assets/assets.service.ts','apps/api/src/fleet/fleet.service.ts',
    'apps/api/src/advanced-inventory/advanced-inventory.service.ts','apps/api/src/returns/returns.service.ts','apps/api/src/finance-operations/finance-operations.service.ts',
  ]) assert.match(read(path), /AccountingCoreService/);
});

test('goods receipt uses inspection before confirmation posting', () => {
  const text = read('apps/api/src/goods-receipts/goods-receipts.service.ts');
  assert.match(text, /PENDING_INSPECTION/);
  assert.match(text, /operationalInspection/);
  assert.match(text, /postOperationalEvent/);
  assert.match(text, /PURCHASE_RECEIPT_CREDIT/);
});

test('return flows reverse inventory, accounting and tax', () => {
  const text = read('apps/api/src/returns/returns.service.ts');
  assert.match(text, /SALE_RETURN/);
  assert.match(text, /PURCHASE_RETURN/);
  assert.match(text, /taxAmount\.negated/);
  assert.match(text, /inventoryMovement/);
});

test('app module wires enterprise modules', () => {
  const app = read('apps/api/src/app.module.ts');
  for (const module of ['AccountingCoreModule','OperationsControlModule','AssetsModule','FleetModule','FinanceOperationsModule','ReturnsModule']) assert.match(app, new RegExp(module));
});


test('assets depreciation uses accounting core instead of direct journal creation', () => {
  const text = read('apps/api/src/assets/assets.service.ts');
  assert.match(text, /ASSET_DEPRECIATION/);
  assert.doesNotMatch(text, /journalEntry\.create/);
});
