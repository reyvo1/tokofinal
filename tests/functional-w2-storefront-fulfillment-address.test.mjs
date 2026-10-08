import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const schema = read('apps/api/prisma/schema.prisma');
const sqlite = read('apps/api/prisma/schema.sqlite.prisma');
const pg = read('apps/api/prisma/schema.postgresql.prisma');
const svc = read('apps/api/src/storefront-customer/storefront-customer.service.ts');
const ctl = read('apps/api/src/storefront-customer/storefront-customer.controller.ts');
const orders = read('apps/api/src/orders/orders.service.ts');
const page = read('apps/storefront/app/page.tsx');
const seed = read('apps/api/prisma/seed.ts');

for (const [name, value] of [['canonical',schema],['sqlite',sqlite],['postgres',pg]]) {
  test(`${name}: address book and fulfillment fields exist`, () => {
    assert.match(value, /model CustomerAddress \{/);
    assert.match(value, /fulfillmentType String\s+@default\("DELIVERY"\)/);
    assert.match(value, /shippingMethodCode String\?/);
    assert.match(value, /pickupWarehouseId String\?/);
  });
}

test('customer address endpoints are account-scoped', () => {
  assert.match(ctl, /@Get\('addresses'\)/);
  assert.match(ctl, /@Post\('addresses'\)/);
  assert.match(svc, /customerId: identity\.customerId/);
  assert.match(svc, /CUSTOMER_ADDRESS_CREATED/);
});

test('order validates courier and address on server and snapshots fulfillment', () => {
  assert.match(orders, /type: 'COURIER'/);
  assert.match(orders, /customerAddress\.findFirst/);
  assert.match(orders, /Metode pengiriman tidak sesuai/);
  assert.match(orders, /shippingCost = new Prisma\.Decimal/);
  assert.match(orders, /pickupWarehouseId: fulfillmentType === 'PICKUP'/);
  assert.match(orders, /revenue: new Prisma\.Decimal\(order\.subtotal\)\.add\(order\.shippingCost\)/);
});

test('pickup and local delivery are seeded and storefront exposes selection', () => {
  assert.match(seed, /code: 'LOCAL_DELIVERY'/);
  assert.match(seed, /fulfillmentType: 'PICKUP'/);
  assert.match(page, /storefront\/account\/fulfillment-options/);
  assert.match(page, /Alamat tersimpan/);
  assert.match(page, /Ambil di toko/);
});
