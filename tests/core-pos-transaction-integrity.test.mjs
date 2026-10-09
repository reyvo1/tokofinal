import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(path, 'utf8');
const salesController = read('apps/api/src/sales/sales.controller.ts');
const sales = read('apps/api/src/sales/sales.service.ts');
const pos = read('apps/pos/app/page.tsx');
const idem = read('apps/api/src/common/idempotency.ts');
const extensions = read('apps/api/src/extensions/extensions.service.ts');
const extensionsController = read('apps/api/src/extensions/extensions.controller.ts');
const returns = read('apps/api/src/returns/returns.service.ts');
const orders = read('apps/api/src/orders/orders.service.ts');
const receipts = read('apps/api/src/goods-receipts/goods-receipts.service.ts');
const seed = read('apps/api/prisma/seed.ts');

const outboxFiles = [
  'apps/api/src/advanced-inventory/advanced-inventory.service.ts',
  'apps/api/src/orders/orders.service.ts',
  'apps/api/src/sales/sales.service.ts',
  'apps/api/src/finance-operations/finance-operations.service.ts',
  'apps/api/src/goods-receipts/goods-receipts.service.ts',
  'apps/api/src/returns/returns.service.ts',
];

test('cashier shift lifecycle is reachable from API and enforced by POS', () => {
  for (const route of ["@Get('shifts/current')", "@Post('shifts/open')", "@Post('shifts/close')", "@Get('shifts/:id/recap')"]) {
    assert.match(salesController, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(sales, /userId: user\.sub,[\s\S]*status: 'OPEN'/);
  assert.match(sales, /Kasir wajib membuka shift sebelum membuat penjualan/);
  assert.match(pos, /cashierShiftId: shift\.id/);
  assert.match(pos, /BUKA SHIFT DULU/);
});

test('seed provides a real CASHIER account while POS does not prefill demo credentials', () => {
  assert.match(seed, /email: 'kasir@toko360\.local'/);
  assert.match(seed, /SEED_CASHIER_PASSWORD \?\? 'Kasir123!'/);
  assert.match(seed, /name: 'CASHIER'/);
  assert.doesNotMatch(pos, /email: 'kasir@toko360\.local', password: 'Kasir123!'/);
  assert.match(pos, /useState\(\{ email: '', password: '', twoFactorCode: '' \}\)/);
});

test('cash drawer expected value counts cash settlement, manual cash movement, and cash refunds', () => {
  assert.match(sales, /if \(this\.paymentIsCash\(payment\)\) cashSales \+= Number\(payment\.amount\)/);
  assert.match(sales, /this\.refundCashAmount\(row\.refundDetails, row\.refundMethod, row\.refundAmount\)/);
  assert.match(sales, /cashMovements\.filter\(\(item\) => item\.type === 'CASH_IN'\)/);
  assert.match(sales, /cashMovements\.filter\(\(item\) => item\.type === 'CASH_OUT'\)/);
  assert.match(sales, /cashSales: cashSales \+ ppobCashSales/, 'paid PPOB cash belongs to shift cash sales');
  assert.match(sales, /cashRefunds: cashRefundRows\.reduce\(\(sum, amount\) => sum \+ amount, 0\) \+ ppobRefunds/, 'paid PPOB refunds belong to shift cash refunds');
  assertExpectedCashFormula(sales);

});

// W3 replaced the numeric expected-cash expression with a two-decimal Prisma.Decimal.
// The previous test matched only the legacy spelling and did not recognize W3's
// equivalent business formula. Keep all five signs and the rounding as hard gates.
const EXPECTED_CASH_FORMULA = /const expected = new Prisma\.Decimal\(\s*Number\(shift\.openingCash\)\s*\+\s*summary\.cashSales\s*\+\s*summary\.cashIn\s*-\s*summary\.cashOut\s*-\s*summary\.cashRefunds\s*\)\s*\.toDecimalPlaces\(2\);/;

function assertExpectedCashFormula(source) {
  const closeShiftAt = source.indexOf('async closeShift(');
  const recapAt = source.indexOf('async shiftRecap(', closeShiftAt);
  assert.ok(closeShiftAt !== -1 && recapAt > closeShiftAt, 'closeShift and shiftRecap boundaries must exist');
  const closeShift = source.slice(closeShiftAt, recapAt);
  assert.match(closeShift, EXPECTED_CASH_FORMULA,
    'expected drawer cash = opening + all cash sales (including PPOB) + cash in - cash out - all refunds, rounded to 2 decimal places');
  assert.match(closeShift, /const difference = declared\.minus\(expected\);/,
    'variance must compare declared cash against expected cash');
  assert.match(closeShift, /const shortfall = expected\.minus\(declared\);/,
    'cash shortage direction must not be inverted');
}

test('W3 cash recap negative controls refuse missing terms, inverted signs or lost rounding', () => {
  assertExpectedCashFormula(sales);
  const mutations = [
    ['opening cash removed', /Number\(shift\.openingCash\) \+ /, ''],
    ['cash sale sign reversed', /\+ summary\.cashSales/, '- summary.cashSales'],
    ['cash in removed', /\+ summary\.cashIn/, ''],
    ['cash out sign reversed', /- summary\.cashOut/, '+ summary.cashOut'],
    ['refund removed', /- summary\.cashRefunds/, ''],
    ['rounding removed', /\.toDecimalPlaces\(2\);/, ';'],
    ['shortage sign reversed', /const shortfall = expected\.minus\(declared\);/, 'const shortfall = declared.minus(expected);'],
  ];
  for (const [name, search, replacement] of mutations) {
    const start = sales.indexOf('async closeShift(');
    const end = sales.indexOf('async shiftRecap(', start);
    const original = sales.slice(start, end);
    const mutated = original.replace(search, replacement);
    assert.notEqual(mutated, original, `negative control must actually mutate source: ${name}`);
    const wholeMutated = sales.slice(0, start) + mutated + sales.slice(end);
    assert.throws(() => assertExpectedCashFormula(wholeMutated), undefined,
      `cash drawer gate must reject: ${name}`);
  }
});

test('POS total is server-authoritative and no longer hardcodes 11 percent tax', () => {
  assert.match(salesController, /@Post\('quote'\)/);
  assert.match(pos, /'\/sales\/quote'/);
  assert.match(pos, /Pajak \(aturan server\)/);
  assert.doesNotMatch(pos, /taxRate\s*=\s*0\.11|Pajak 11%/);
  assert.match(sales, /calculateTax\([\s\S]*scope\.companyId/);
});

test('sale retry uses a stable idempotency key and in-progress duplicates are rejected', () => {
  assert.match(pos, /pendingPaymentRef/);
  assert.match(pos, /pending\?\.fingerprint === fingerprint \? pending\.key : newIdempotencyKey\(\)/);
  assert.match(pos, /idempotencyKey/);
  assert.match(idem, /class IdempotencyInProgressError extends ConflictException/);
  assert.match(idem, /expiresAt: new Date\(Date\.now\(\) \+ processingTtlMs\)/);
});

test('sync pull and outbox events are tenant-scoped and pageable without timestamp-only paging', () => {
  assert.match(extensions, /companyId: scope\.companyId,[\s\S]*createdAt: \{ gte: sinceDate \}/);
  assert.match(extensions, /cursor: \{ id: cursor \}, skip: 1/);
  assert.match(extensions, /const nextCursor = hasMore \? lastEvent\?\.id \?\? null : null/);
  assert.match(extensions, /syncReceipt\.upsert/);
  assert.match(extensions, /receiptId/);
  assert.match(extensions, /OR: \[\{ branchId: null \}, \{ branchId: scope\.branchId \}\]/);
  assert.match(extensions, /branchIds\.includes\(scope\.branchId\)/);
  assert.match(extensions, /deviceId: \{ in: deviceIds \}/);
  assert.match(extensionsController, /@Permissions\('integration\.manage'\)[\s\S]*submitOfflineTransactions/);
  for (const file of outboxFiles) {
    const source = read(file);
    const creates = source.split('eventOutbox.create').slice(1);
    assert.ok(creates.length > 0, `${file} must have outbox writes`);
    for (const create of creates) {
      const near = create.slice(0, 600);
      assert.match(near, /data:\s*\{[\s\S]*?companyId:/, `${file} outbox write must persist companyId column`);
    }
  }
});

test('tax calculation in sale, storefront order and goods receipt is company-scoped', () => {
  assert.match(sales, /calculateTax\([\s\S]*discountedBase,[\s\S]*scope\.companyId,[\s\S]*occurredAt,[\s\S]*\['SALE', 'OTHER'\]/);
  assert.match(orders, /discountedBase,\s*branch\.companyId,\s*transactionAt,\s*\['SALE', 'OTHER'\],\s*\)/);
  assert.match(receipts, /purchaseTaxCodeId \?\? undefined,[\s\S]*base,[\s\S]*scope\.companyId,[\s\S]*new Date\(\),[\s\S]*\['PURCHASE', 'OTHER'\]/);
});

test('sale returns cannot cumulatively exceed sold quantity and partial refunds only revoke partial earned points', () => {
  assert.match(returns, /const previousReturns = await this\.prisma\.saleReturn\.findMany/);
  assert.match(returns, /used \+ requestedQty > original\.quantity/);
  assert.match(returns, /const earnedOnReturnedAmount = Math\.floor\(Number\(gross\) \* Number\(program\.earnRate\)\)/);
  assert.doesNotMatch(returns, /const earnedOnSale = Math\.floor/);
});
