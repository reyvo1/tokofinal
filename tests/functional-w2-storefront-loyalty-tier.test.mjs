import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const tier = readFileSync(new URL('../apps/api/src/common/loyalty-tier.ts', import.meta.url), 'utf8');
const promos = readFileSync(new URL('../apps/api/src/promotions/promotions.service.ts', import.meta.url), 'utf8');
const sales = readFileSync(new URL('../apps/api/src/sales/sales.service.ts', import.meta.url), 'utf8');
const orders = readFileSync(new URL('../apps/api/src/orders/orders.service.ts', import.meta.url), 'utf8');
const returns = readFileSync(new URL('../apps/api/src/returns/returns.service.ts', import.meta.url), 'utf8');
const customer = readFileSync(new URL('../apps/api/src/storefront-customer/storefront-customer.service.ts', import.meta.url), 'utf8');
const storefront = readFileSync(new URL('../apps/storefront/app/page.tsx', import.meta.url), 'utf8');

test('loyalty tier resolver is deterministic and clamps discount configuration', () => {
  assert.match(tier, /resolveLoyaltyTier/);
  assert.match(tier, /lifetime >= item\.minPoints/);
  assert.match(tier, /Math\.min\(50, Math\.max\(0, discountPct\)\)/);
  assert.match(tier, /MEMBER/);
});

test('tier-restricted promotions resolve the actual customer tier instead of rejecting the feature', () => {
  assert.match(promos, /customerTier\(/);
  assert.match(promos, /resolveLoyaltyTier\(program\.tiers/);
  assert.match(promos, /actualTier\.toUpperCase\(\) !== rule\.memberTier\.toUpperCase\(\)/);
  assert.doesNotMatch(promos, /evaluasi tier otomatis belum tersedia/);
  assert.match(sales, /resolveSalePromotion\(this\.prisma, scope, rawSubtotal, dto\.promoCode, new Date\(\), dto\.customerId, \{ channel: 'POS'/);
  assert.match(sales, /resolveSalePromotion\(tx, scope, rawSubtotal, dto\.promoCode, occurredAt, dto\.customerId, \{ channel: 'POS'/);
});

test('completed storefront orders earn loyalty points exactly through an Order reference', () => {
  assert.match(orders, /referenceType: 'Order', referenceId: order\.id/);
  assert.match(orders, /type: 'EARN'/);
  assert.match(orders, /pointsExpireDays/);
  assert.match(orders, /lifetimePoints: nextLifetime/);
  assert.match(orders, /tier: loyaltyTier/);
  assert.match(orders, /loyaltyEarned/);
});

test('online order returns revoke only remaining earned points and never make balance negative', () => {
  assert.match(returns, /referenceType: 'OrderReturn'/);
  assert.match(returns, /remainingEarned/);
  assert.match(returns, /Math\.min\(calculated, remainingEarned, account\.points\)/);
  assert.match(returns, /type: 'REFUND'/);
  assert.match(returns, /points: -loyaltyRevoked/);
});

test('storefront account reads the canonical loyalty account balance and exposes tier', () => {
  assert.match(customer, /loyaltyAccount\.findUnique/);
  assert.match(customer, /points: account\?\.points \?\? 0/);
  assert.match(customer, /loyaltyTier: resolveLoyaltyTier/);
  assert.match(storefront, /Tier:/);
  assert.match(storefront, /account\.loyaltyTier/);
});
