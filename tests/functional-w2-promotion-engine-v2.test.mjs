import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(p, 'utf8');
const service = read('apps/api/src/promotions/promotions.service.ts');
const dto = read('apps/api/src/promotions/dto/promotions.dto.ts');
const sales = read('apps/api/src/sales/sales.service.ts');
const orders = read('apps/api/src/orders/orders.service.ts');
const orderDto = read('apps/api/src/orders/dto/create-order.dto.ts');
const ordersModule = read('apps/api/src/orders/orders.module.ts');
const worker = read('apps/worker/src/index.ts');
const storefront = read('apps/storefront/app/page.tsx');
const admin = read('apps/admin/app/modules/extensions.tsx');
const schemas = ['apps/api/prisma/schema.prisma','apps/api/prisma/schema.sqlite.prisma','apps/api/prisma/schema.postgresql.prisma'].map(read);

test('promotion v2 schema tracks eligibility and redemptions in all runtimes', () => {
  for (const schema of schemas) {
    assert.match(schema, /model PromoRedemption \{/);
    for (const field of ['channel','productIds','minQuantity','buyQuantity','getQuantity','usageLimit','perCustomerLimit']) assert.match(schema, new RegExp(`\\b${field}\\s+`));
    assert.match(schema, /@@unique\(\[promoRuleId, referenceType, referenceId\]\)/);
  }
});

test('promotion DTO supports percent nominal quantity break BOGO bundle channel products and quota', () => {
  assert.match(dto, /'PERCENT', 'AMOUNT', 'QUANTITY_BREAK', 'BOGO', 'BUNDLE'/);
  assert.match(dto, /'ALL', 'POS', 'STOREFRONT'/);
  assert.match(dto, /productIds\?: string\[\]/);
  assert.match(dto, /usageLimit\?: number/);
  assert.match(dto, /perCustomerLimit\?: number/);
});

test('canonical promotion engine is line-aware, channel-aware and quota-aware', () => {
  assert.match(service, /export function computeLineAwareDiscount/);
  assert.match(service, /case 'QUANTITY_BREAK'/);
  assert.match(service, /case 'BOGO'/);
  assert.match(service, /case 'BUNDLE'/);
  assert.match(service, /cheapest eligible units free|unit eligible termurah|sort\(\(a, b\) => Number\(a\.unitPrice\) - Number\(b\.unitPrice\)\)/i);
  assert.match(service, /rule\.channel !== 'ALL'/);
  assert.match(service, /promoRedemption\.count/);
  assert.match(service, /async recordRedemption/);
});

test('POS evaluates cart lines and records promotion redemption atomically', () => {
  assert.match(sales, /channel: 'POS'/);
  assert.match(sales, /lines: raw\.map/);
  assert.match(sales, /promotions\.recordRedemption\(tx, scope, promotion\.rule\.id, dto\.customerId, 'Sale'/);
});

test('Storefront accepts promo code, applies server discount, records and releases reservation on cancel/expiry', () => {
  assert.match(orderDto, /promoCode\?: string/);
  assert.match(ordersModule, /PromotionsModule/);
  assert.match(orders, /channel: 'STOREFRONT'/);
  assert.match(orders, /discount: promoDiscount/);
  assert.match(orders, /recordRedemption\(tx, \{ companyId: branch\.companyId, branchId: branch\.id \}.*'Order'/s);
  assert.match(orders, /promoRedemption\.deleteMany\(\{ where: \{ referenceType: 'Order'/);
  assert.match(worker, /promoRedemption\.deleteMany\(\{ where: \{ referenceType: 'Order'/);
  assert.match(storefront, /Voucher \/ kode promo/);
  assert.match(storefront, /promoCode: promoCode\.trim\(\) \|\| undefined/);
});

test('Admin can configure advanced promotion rules without Postman', () => {
  assert.match(admin, /PROMOTION ENGINE/);
  assert.match(admin, /QUANTITY_BREAK/);
  assert.match(admin, /BOGO/);
  assert.match(admin, /BUNDLE/);
  assert.match(admin, /Quota global/);
  assert.match(admin, /Produk eligible/);
});
