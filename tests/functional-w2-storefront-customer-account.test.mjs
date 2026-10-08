import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const service = readFileSync(new URL('../apps/api/src/storefront-customer/storefront-customer.service.ts', import.meta.url), 'utf8');
const controller = readFileSync(new URL('../apps/api/src/storefront-customer/storefront-customer.controller.ts', import.meta.url), 'utf8');
const moduleFile = readFileSync(new URL('../apps/api/src/storefront-customer/storefront-customer.module.ts', import.meta.url), 'utf8');
const appModule = readFileSync(new URL('../apps/api/src/app.module.ts', import.meta.url), 'utf8');
const orders = readFileSync(new URL('../apps/api/src/orders/orders.service.ts', import.meta.url), 'utf8');
const ordersController = readFileSync(new URL('../apps/api/src/orders/orders.controller.ts', import.meta.url), 'utf8');
const storefront = readFileSync(new URL('../apps/storefront/app/page.tsx', import.meta.url), 'utf8');
const schemas = ['schema.prisma','schema.sqlite.prisma','schema.postgresql.prisma'].map((name) => readFileSync(new URL(`../apps/api/prisma/${name}`, import.meta.url), 'utf8'));

test('storefront customer account uses hashed passwords, opaque revocable sessions and lockout', () => {
  assert.match(service, /hash\(dto\.password, 12\)/);
  assert.match(service, /compare\(dto\.password, account\.passwordHash\)/);
  assert.match(service, /randomBytes\(32\)\.toString\('base64url'\)/);
  assert.match(service, /createHash\('sha256'\)\.update\(token\)\.digest\('hex'\)/);
  assert.match(service, /failedAttempts >= 5/);
  assert.match(service, /15 \* 60 \* 1000/);
  assert.match(service, /revokedAt: new Date\(\)/);
  assert.doesNotMatch(service, /passwordHash[^\n]*return/);
});

test('customer sessions are company and branch constrained and order history is customer-owned', () => {
  assert.match(service, /session\.customer\.companyId !== branch\.companyId/);
  assert.match(service, /where: \{ branchId: identity\.branchId, customerId: identity\.customerId \}/);
  assert.match(service, /where: \{ number, branchId: identity\.branchId, customerId: identity\.customerId \}/);
  assert.match(ordersController, /@Headers\('x-customer-session'\) customerSession/);
  assert.match(orders, /customerIdentity = customerSessionToken[\s\S]*storefrontCustomers\.authenticate/);
  assert.match(orders, /customerId: customerIdentity\?\.customerId/);
  assert.match(orders, /order:create:\$\{branch\.id\}:\$\{customerIdentity\?\.customerId \?\? 'guest'\}/);
});

test('customer account module is public only through its explicit opaque-session endpoints', () => {
  assert.match(controller, /@Public\(\)[\s\S]*@Controller\('storefront\/account'\)/);
  assert.match(controller, /@Post\('register'\)/);
  assert.match(controller, /@Post\('login'\)/);
  assert.match(controller, /@Post\('logout'\)/);
  assert.match(controller, /@Get\('me'\)/);
  assert.match(controller, /@Get\('orders'\)/);
  assert.match(controller, /@Get\('orders\/:number'\)/);
  assert.match(moduleFile, /exports: \[StorefrontCustomerService\]/);
  assert.match(appModule, /StorefrontCustomerModule/);
});

test('all Prisma schemas carry customer accounts sessions and optional order ownership', () => {
  for (const schema of schemas) {
    assert.match(schema, /model CustomerAccount \{/);
    assert.match(schema, /customerId\s+String\s+@unique/);
    assert.match(schema, /model CustomerSession \{/);
    assert.match(schema, /tokenHash\s+String\s+@unique/);
    assert.match(schema, /customerId\s+String\?/);
    assert.match(schema, /customer\s+Customer\?\s+@relation\(fields: \[customerId\], references: \[id\]\)/);
    assert.match(schema, /@@index\(\[customerId, createdAt\]\)/);
  }
});

test('storefront exposes login registration and protected order tracking without browser-only fake history', () => {
  assert.match(storefront, /accountMode === 'login' \? 'login' : 'register'/);
  assert.match(storefront, /storefront\/account\/\$\{endpoint\}/);
  assert.match(storefront, /storefront\/account\/orders/);
  assert.match(storefront, /x-customer-session/);
  assert.match(storefront, /RIWAYAT & TRACKING/);
  assert.match(storefront, /trackingNumber/);
  assert.match(storefront, /localStorage\.setItem\('toko360\.customer\.session'/);
});
