import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (file) => readFileSync(file, 'utf8');
const sales = read('apps/api/src/sales/sales.service.ts');
const salesController = read('apps/api/src/sales/sales.controller.ts');
const saleDto = read('apps/api/src/sales/dto/create-sale.dto.ts');
const promo = read('apps/api/src/promotions/promotions.service.ts');
const seed = read('apps/api/prisma/seed.ts');
const pos = read('apps/pos/app/page.tsx');
const adminExtensions = read('apps/admin/app/modules/extensions.tsx');
const sqlite = read('apps/api/prisma/schema.sqlite.prisma');
const postgres = read('apps/api/prisma/schema.postgresql.prisma');

function models(schema) { return [...schema.matchAll(/^model\s+(\w+)/gm)].map((m) => m[1]); }

test('W2 POS: promo server diterapkan ke quote dan transaksi nyata', () => {
  assert.match(saleDto, /promoCode\?: string/);
  assert.match(sales, /resolveSalePromotion\(this\.prisma, scope, rawSubtotal, dto\.promoCode, new Date\(\), dto\.customerId, \{ channel: 'POS'/);
  assert.match(sales, /resolveSalePromotion\(tx, scope, rawSubtotal, dto\.promoCode, occurredAt, dto\.customerId, \{ channel: 'POS'/);
  assert.match(sales, /discount\.plus\(promoDiscount\)\.plus\(loyaltyRedeemDiscount\)/);
  assert.match(promo, /computeLineAwareDiscount/);
  assert.match(sales, /recordRedemption/);
});

test('W2 POS: split payment divalidasi dan diposting ke jurnal split', () => {
  assert.match(saleDto, /payments\?: SalePaymentDto\[\]/);
  assert.match(sales, /Total tender .* piutang .* tidak sama dengan total transaksi/);
  assert.match(sales, /resolveSalePayments\(tx, scope, rawRequestedPayments\)/);
  assert.match(sales, /SALE_SPLIT/);
  assert.match(sales, /additionalJournalLines: settlementJournalLines/);
  assert.match(seed, /code: 'SALE-SPLIT'/);
});

test('W2 POS: transaksi offline menolak promo dan split payment', () => {
  assert.match(sales, /OFFLINE_PROMO_NOT_ALLOWED/);
  assert.match(sales, /Split payment dan piutang pelanggan tidak boleh direkam saat offline/);
  assert.match(sales, /!offlineTender \|\| !offlineTender\.policy\.allowOffline/);
  assert.match(pos, /tender yang diizinkan konfigurasi server/);
});

test('W2 POS: cash movement menjadi bagian expected cash shift', () => {
  assert.ok(models(sqlite).includes('CashierCashMovement'));
  assert.ok(models(postgres).includes('CashierCashMovement'));
  assert.match(salesController, /@Post\('shifts\/cash-movements'\)/);
  assert.match(sales, /summary\.cashIn - summary\.cashOut - summary\.cashRefunds/);
  assert.match(sales, /cashierCashMovement\.create/);
});

test('W2 POS: hold dan recall tersedia pada terminal kasir', () => {
  assert.match(pos, /function holdCart\(\)/);
  assert.match(pos, /function recallHeld\(id: string\)/);
  assert.match(pos, /Transaksi Hold/);
  assert.match(pos, /HELD_SALES_KEY/);
});

test('W2 POS: UI menyediakan promo, split payment, kas masuk dan keluar', () => {
  assert.match(pos, /Kode promo/);
  assert.match(pos, /SPLIT PAYMENT/);
  assert.match(pos, /KAS MASUK/);
  assert.match(pos, /KAS KELUAR/);
});

test('W0/W2 integration: frontend tidak lagi memakai prefix extensions yang tidak diekspos API', () => {
  assert.doesNotMatch(adminExtensions, /\/extensions\/(shipments|loyalty|notifications)/);
  assert.doesNotMatch(pos, /\/extensions\/(customers|loyalty)/);
  assert.match(adminExtensions, /\$\{API\}\/shipments/);
  assert.match(pos, /'\/customers\?limit=100'/);
});
