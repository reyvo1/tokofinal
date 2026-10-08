import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(path, 'utf8');

test('goods receipt endpoints derive tenant scope from authenticated user', () => {
  const controller = read('apps/api/src/goods-receipts/goods-receipts.controller.ts');
  const service = read('apps/api/src/goods-receipts/goods-receipts.service.ts');

  assert.match(controller, /list\(\s*@CurrentUser\(\) user: AuthUser/);
  assert.match(service, /private requireTenantScope\(user: AuthUser\)/);
  assert.match(service, /branchId: scope\.branchId/);
  assert.match(service, /branch: \{ companyId: scope\.companyId \}/);
  assert.match(service, /action: 'TENANT_ACCESS_DENIED'/);
});

test('goods receipt mutations reject cross-tenant purchase orders, receipts, and inspections', () => {
  const service = read('apps/api/src/goods-receipts/goods-receipts.service.ts');

  assert.match(service, /findFirst\(\{\s*where: \{\s*id: dto\.purchaseOrderId,[\s\S]*branchId: scope\.branchId/);
  assert.match(service, /denyTenantAccess\(user, scope, 'PurchaseOrder', dto\.purchaseOrderId\)/);
  assert.match(service, /denyTenantAccess\(user, scope, 'GoodsReceipt', id\)/);
  assert.match(service, /companyId: scope\.companyId,\s*branchId: scope\.branchId,\s*sourceType: 'GoodsReceipt'/);
});
