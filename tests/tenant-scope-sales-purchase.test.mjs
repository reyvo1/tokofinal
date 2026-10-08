import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(path, 'utf8');

test('sales endpoints derive tenant scope from authenticated user', () => {
  const controller = read('apps/api/src/sales/sales.controller.ts');
  const service = read('apps/api/src/sales/sales.service.ts');

  assert.match(controller, /list\(\s*@CurrentUser\(\) user: AuthUser/);
  assert.match(service, /branchId: scope\.branchId/);
  assert.match(service, /branch: \{ companyId: scope\.companyId \}/);
  assert.match(service, /action: 'TENANT_ACCESS_DENIED'/);
  assert.match(service, /userId: user\.sub/);
});

test('purchase order endpoints enforce warehouse tenant scope', () => {
  const controller = read('apps/api/src/purchase-orders/purchase-orders.controller.ts');
  const service = read('apps/api/src/purchase-orders/purchase-orders.service.ts');

  assert.match(controller, /@CurrentUser\(\) user: AuthUser/);
  assert.match(service, /warehouse: \{\s*branchId: scope\.branchId,/);
  assert.match(service, /branch: \{ companyId: scope\.companyId \}/);
  assert.match(service, /action: 'CREATE_PURCHASE_ORDER'/);
  assert.match(service, /action: 'TENANT_ACCESS_DENIED'/);
});
