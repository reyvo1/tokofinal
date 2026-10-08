import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const service = readFileSync(new URL('../apps/api/src/storefront-customer/storefront-customer.service.ts', import.meta.url), 'utf8');
const controller = readFileSync(new URL('../apps/api/src/storefront-customer/storefront-customer.controller.ts', import.meta.url), 'utf8');
const storefront = readFileSync(new URL('../apps/storefront/app/page.tsx', import.meta.url), 'utf8');
const schemas = ['schema.prisma','schema.sqlite.prisma','schema.postgresql.prisma'].map((name) => readFileSync(new URL(`../apps/api/prisma/${name}`, import.meta.url), 'utf8'));

for (const schema of schemas) {
  test('storefront favorite and review models remain customer/product unique', () => {
    assert.match(schema, /model ProductFavorite[\s\S]*@@unique\(\[customerId, productId\]\)/);
    assert.match(schema, /model ProductReview[\s\S]*rating\s+Int[\s\S]*@@unique\(\[customerId, productId\]\)/);
  });
}

test('favorite APIs authenticate the customer session and scope the product to the active company', () => {
  assert.match(controller, /@Get\('favorites'\)/);
  assert.match(controller, /@Post\('favorites\/:productId'\)/);
  assert.match(controller, /@Delete\('favorites\/:productId'\)/);
  assert.match(service, /const identity = await this\.authenticate\(branchCode, token\)/);
  assert.match(service, /companyId: identity\.companyId, isActive: true/);
  assert.match(service, /customerId_productId/);
});

test('review creation is verified-purchase only and fails closed for unfinished or foreign orders', () => {
  assert.match(service, /customerId: identity\.customerId, status: 'COMPLETED'/);
  assert.match(service, /items: \{ some: \{ productId: dto\.productId/);
  assert.match(service, /Review hanya dapat dibuat untuk produk dari pesanan akun yang sudah selesai/);
  assert.match(service, /CUSTOMER_PRODUCT_REVIEWED/);
});

test('public review summary exposes only PUBLISHED reviews inside the storefront company', () => {
  assert.match(controller, /@Get\('reviews\/product\/:productId'\)/);
  assert.match(service, /status: 'PUBLISHED', product: \{ companyId: branch\.companyId \}/);
  assert.match(service, /averageRating/);
});

test('storefront UI loads favorites and provides verified-order review actions', () => {
  assert.match(storefront, /storefront\/account\/favorites/);
  assert.match(storefront, /toggleFavorite/);
  assert.match(storefront, /item\.status === 'COMPLETED'/);
  assert.match(storefront, /submitReview/);
  assert.match(storefront, /Review verified-purchase berhasil disimpan/);
});
