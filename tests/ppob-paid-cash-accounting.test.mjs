import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const service = read('apps/api/src/digital-services/digital-services.service.ts');
const worker = read('apps/worker/src/index.ts');
const cash = read('apps/api/src/sales/sales.service.ts');
const admin = read('apps/admin/app/modules/digital-services.tsx');
const pos = read('apps/pos/app/ppob-workspace.tsx');
const dto = read('apps/api/src/digital-services/dto/digital-services.dto.ts');

function createBody(source) { return source.slice(source.indexOf('async createTransaction('), source.indexOf('async settle(')); }
function requirePaidPath(source) {
  const body = createBody(source);
  assert.match(body, /const shift = await tx\.cashierShift\.findFirst/);
  assert.match(body, /if \(!shift\) throw new BadRequestException/);
  assert.match(body, /eventType: 'DIGITAL_SERVICE_PREPAYMENT'/);
  assert.match(body, /paymentAccountingEventId: paymentEvent\.id, capturedAt: new Date\(\)/);
  assert.ok(body.indexOf('postOperationalEvent(tx') > body.indexOf('digitalServiceTransaction.create('));
  assert.ok(body.indexOf('postOperationalEvent(tx') < body.indexOf("eventType: 'digital-service.transaction.requested'"));
  assert.match(body, /if \(!existing\.paymentAccountingEventId \|\| !existing\.capturedAt\)/);
}

test('negative control: unpaid PPOB outbox is prohibited and refund cannot happen without original receipt', () => {
  requirePaidPath(service);
  assert.throws(() => requirePaidPath(service.replace('paymentAccountingEventId: paymentEvent.id, capturedAt: new Date()', 'capturedAt: new Date()')), /paymentAccountingEventId/);
  assert.throws(() => requirePaidPath(service.replace("eventType: 'DIGITAL_SERVICE_PREPAYMENT'", "eventType: 'NO_LEDGER'")), /DIGITAL_SERVICE_PREPAYMENT/);
  assert.throws(() => requirePaidPath(service.replace('if (!shift) throw new BadRequestException', 'if (false) throw new BadRequestException')), /shift/);
});

test('SQLite/PostgreSQL/canonical schema and expand-only migrations preserve cash lifecycle parity', () => {
  for (const profile of ['schema.prisma','schema.sqlite.prisma','schema.postgresql.prisma']) {
    const schema = read(`apps/api/prisma/${profile}`);
    const body = schema.slice(schema.indexOf('model DigitalServiceTransaction {'), schema.indexOf('\n}', schema.indexOf('model DigitalServiceTransaction {')));
    for (const column of ['cashierShiftId','paymentAccountingEventId','settlementAccountingEventId','refundAccountingEventId','refundCashierShiftId','capturedAt','settledAt','refundedAt']) assert.match(body,new RegExp(`\\b${column}\\s+\\w+\\?`));
    assert.match(body, /@@unique\(\[companyId, idempotencyKey\]\)/);
  }
  const order = JSON.parse(read('config/expand-migration-order.json'));
  assert.ok(order.migrations.includes('T360-20261009-ppob-paid-fulfillment'));
  for (const provider of ['sqlite','postgresql']) {
    const migration=read(`database/migrations/T360-20261009-ppob-paid-fulfillment/${provider}-expand.sql`);
    for(const column of ['paymentAccountingEventId','refundAccountingEventId','settlementAccountingEventId']) assert.match(migration,new RegExp(`ADD COLUMN "${column}"`));
    assert.doesNotMatch(migration,/\bDROP\s+(?:COLUMN|TABLE)\b/i);
  }
});

test('PPOB posted money never uses a parallel journal; provider result not falsely recognized as paid sale', () => {
  const settle = service.slice(service.indexOf('async settle('), service.indexOf('async refund('));
  const refund = service.slice(service.indexOf('async refund('),service.indexOf('async recheck('));
  assert.match(settle,/row\.status !== 'SUCCESS'/);
  assert.match(settle,/eventType: 'DIGITAL_SERVICE_FULFILLED'/);
  assert.match(settle,/paymentAccountingEventId: row\.paymentAccountingEventId/);
  assert.match(settle,/providerBalanceAccountCode/);
  assert.match(settle,/type: 'ASSET'/);
  assert.match(refund,/row\.status !== 'FAILED'/);
  assert.match(refund,/await this\.sales\.assertDrawerCashAvailable/);
  assert.match(refund,/eventType: 'DIGITAL_SERVICE_REFUND'/);
  assert.doesNotMatch(service,/journalEntry\.(create|update)|accountingPosting\.create/);
  assert.match(read('apps/api/prisma/seed.ts'),/code: 'PPOB-PREPAYMENT'/);
  assert.match(read('apps/api/prisma/seed.ts'),/code: 'PPOB-FULFILLED'/);
  assert.match(read('apps/api/prisma/seed.ts'),/code: 'PPOB-REFUND'/);
});

test('provider worker rejects historical unpaid jobs and unposted/mismatched receipts before external Digiflazz call', () => {
  const body=worker.slice(worker.indexOf('async function processDigiflazzTransaction('),worker.indexOf('async function handleDigitalServiceOutbox('));
  const proof=body.indexOf('PPOB_PAYMENT_LEDGER_MISMATCH');
  const network=body.indexOf("digiflazzPost('/transaction'");
  assert.ok(proof > 0 && network > proof);
  assert.match(body,/eventType: 'DIGITAL_SERVICE_PREPAYMENT', status: 'POSTED'/);
  assert.match(body,/prepaid\.grossAmount\)\.equals\(transaction\.sellingPrice\)/);
  const mapper=worker.slice(worker.indexOf('function mappedDigiflazzStatus('),worker.indexOf('async function processDigiflazzTransaction('));
  assert.match(mapper,/return 'PENDING';/);
  assert.match(mapper,/status === 'gagal' \|\| status === 'failed'/);
  assert.doesNotMatch(mapper,/return 'FAILED';\s*\}/);
});

test('POS purchase requires active shift, cash confirmation, stable retry identity and is online-only', () => {
  assert.match(dto, /paymentMethod!: 'CASH'/);
  assert.match(pos, /!online \|\| !shiftOpen/);
  assert.match(pos, /!purchase\.confirmed/);
  assert.match(pos, /pendingPurchaseRef\.current\?\.fingerprint !== fingerprint/);
  assert.match(pos, /idempotencyKey, \.\.\.\(chosenProduct\.costPrice/);
  assert.match(pos, /pendingPurchaseRef\.current = null;/);
  assert.match(read('apps/pos/app/page.tsx'),/shiftOpen=\{shift\?\.status === 'OPEN'\}/);
});

test('both cashier cash sales and authorized cash refunds affect physical shift cash and overdraft guard', () => {
  assert.match(cash, /ppobCashSales = ppobCashReceipts\.reduce/);
  assert.match(cash, /cashSales: cashSales \+ ppobCashSales/);
  assert.match(cash, /cashRefunds: cashRefundRows\.reduce\(\(sum, amount\) => sum \+ amount, 0\) \+ ppobRefunds/);
  assert.match(cash,/async assertDrawerCashAvailable/);
  assert.match(service,/await this\.sales\.assertDrawerCashAvailable/);
});

test('no-tax product must have explicit audited finance verification, not a silent tax assumption', () => {
  assert.match(service,/metadata\.taxTreatment !== 'NO_TAX_VERIFIED'/);
  assert.match(service,/action: 'VERIFY_DIGITAL_PRODUCT_TAX'/);
  assert.match(read('apps/api/src/digital-services/digital-services.controller.ts'),/@Roles\('SUPER_ADMIN', 'OWNER', 'FINANCE'\)/);
  assert.match(admin,/tax-verification/);
  assert.doesNotMatch(admin,/async function buy\(/);
  assert.match(admin,/providerBalanceAccountCode/);
});


test('finance prerequisites and opt-in gate run before taking any PPOB cash or publishing a provider event', () => {
  const body = createBody(service);
  const cash = body.indexOf('postOperationalEvent(tx');
  for (const check of ['config.ppobCashEnabled !== true', 'providerBalanceAccountCode', "type: 'ASSET'", "'DIGITAL_SERVICE_FULFILLED'", "'DIGITAL_SERVICE_REFUND'", 'dto.maxPrice == null']) {
    const index = body.indexOf(check);
    assert.ok(index >= 0 && index < cash, `Preflight missing or too late: ${check}`);
  }
  assert.match(dto, /maxPrice!: number/);
  assert.match(admin, /ppobCashEnabled/);
  assert.match(admin, /type="checkbox" checked=\{ppobCashEnabled\}/);
});

test('catalog sync cannot forge or silently discard verified tax classification', () => {
  const sync = worker.slice(worker.indexOf('async function syncDigiflazzCatalog('), worker.indexOf('function mappedDigiflazzStatus('));
  assert.match(sync, /taxVerificationReason/);
  assert.match(sync, /sameProduct/);
  assert.match(sync, /!\['taxTreatment','taxVerificationReason','taxVerifiedById','taxVerifiedAt'\]\.includes\(key\)/);
  assert.match(sync, /metadata: mergedMetadata/);
});


test('physical cash change is explicitly acknowledged, and ambiguous provider error never permits refund', () => {
  assert.match(pos, /purchase\.changeReturned/);
  assert.match(pos, /Uang kembalian/);
  assert.match(pos, /Saya sudah menyerahkan kembalian/);
  const mapper=worker.slice(worker.indexOf('function mappedDigiflazzStatus('),worker.indexOf('async function processDigiflazzTransaction('));
  assert.doesNotMatch(mapper,/status === 'error'/);
  assert.match(mapper,/return 'PENDING'/);
  assert.match(service,/maxPrice\.greaterThan\(price\)/);
});
