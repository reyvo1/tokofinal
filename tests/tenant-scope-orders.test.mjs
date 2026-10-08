import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const controller = readFileSync('apps/api/src/orders/orders.controller.ts', 'utf8');
const service = readFileSync('apps/api/src/orders/orders.service.ts', 'utf8');
const dto = readFileSync('apps/api/src/orders/dto/create-order.dto.ts', 'utf8');
const storefront = readFileSync('apps/storefront/app/page.tsx', 'utf8');

 test('authenticated order list is company and branch scoped', () => {
  assert.match(controller, /@CurrentUser\(\) user: AuthUser/);
  assert.match(controller, /this\.orders\.list\(user, limit, cursor\)/);
  assert.match(service, /branchId: scope\.branchId/);
  assert.match(service, /branch: \{ companyId: scope\.companyId \}/);
});

test('public order access requires branch code and signed access token', () => {
  assert.match(controller, /x-branch-code/);
  assert.match(controller, /x-order-access-token/);
  assert.match(service, /createHmac\('sha256'/);
  assert.match(service, /timingSafeEqual/);
  assert.match(service, /TENANT_ACCESS_DENIED/);
});

test('public order creation resolves warehouse inside requested branch', () => {
  assert.match(dto, /branchCode!: string/);
  assert.match(service, /where: \{ branchId: branch\.id, isDefault: true, isActive: true \}/);
  assert.match(service, /where: \{ id: dto\.warehouseId, branchId: branch\.id, isActive: true \}/);
  assert.doesNotMatch(service, /findFirst\(\{ where: \{ isDefault: true \}/);
});

test('tax codes and event payloads retain tenant context', () => {
  assert.match(service, /companyId: branch\.companyId, status: 'ACTIVE'/);
  assert.match(service, /companyId: branch\.companyId, branchId: branch\.id/);
  assert.match(service, /companyId: order\.warehouse\.branch\.companyId/);
});

test('storefront carries branch and order access token', () => {
  assert.match(storefront, /NEXT_PUBLIC_BRANCH_CODE/);
  assert.match(storefront, /const \[branchCode, setBranchCode\] = useState\(DEFAULT_BRANCH_CODE\)/);
  assert.match(storefront, /branchCode: branchCode/);
  assert.match(storefront, /toko360\.storefront\.branch/);
  assert.match(storefront, /'x-order-access-token': order\.accessToken/);
});
