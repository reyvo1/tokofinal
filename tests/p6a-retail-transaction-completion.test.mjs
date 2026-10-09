import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const salesDto = read('apps/api/src/sales/dto/create-sale.dto.ts');
const sales = read('apps/api/src/sales/sales.service.ts');
const tenderPolicy = read('apps/api/src/common/tender-policy.ts');
const accounting = read('apps/api/src/accounting-core/accounting-core.service.ts');
const finance = read('apps/api/src/finance-operations/finance-operations.service.ts');
const returns = read('apps/api/src/returns/returns.service.ts');
const masterData = read('apps/api/src/master-data/master-data.service.ts');
const pos = read('apps/pos/app/page.tsx');
const adminMaster = read('apps/admin/app/modules/master-data.tsx');
const adminAccounting = read('apps/admin/app/modules/accounting.tsx');
const browserUat = read('scripts/browser-uat.mjs');
const sqliteSchema = read('apps/api/prisma/schema.sqlite.prisma');
const pgSchema = read('apps/api/prisma/schema.postgresql.prisma');
const migrationOrder = JSON.parse(read('config/expand-migration-order.json'));
const productCompleteness = JSON.parse(read('config/product-completeness.json'));
const p6aWorkItem = JSON.parse(read('work-items/active/T360-20261005-154000-p6a-retail-transaction-completion.json'));
const featureCatalog = read('docs/FEATURE-CATALOG.md');

function paymentModel(schema) {
  const match = schema.match(/model Payment \{[\s\S]*?\n\}/);
  assert.ok(match, 'Payment model must exist');
  return match[0];
}

const p6aMigration = 'T360-20261005-p6a-retail-transaction-completion';
const ppobMigration = 'T360-20261009-ppob-paid-fulfillment';

function assertPaymentMigrationLineage(migrations) {
  assert.ok(Array.isArray(migrations), 'Expand migration manifest must contain an ordered array');
  assert.equal(new Set(migrations).size, migrations.length, 'Expand migration names must be unique');
  for (const migration of [p6aMigration, ppobMigration]) {
    assert.equal(migrations.filter((name) => name === migration).length, 1, `${migration} must be registered exactly once`);
  }
  assert.ok(
    migrations.indexOf(p6aMigration) < migrations.indexOf(ppobMigration),
    'P6A payment snapshots must migrate before W2 PPOB paid fulfillment',
  );
  for (let index = 0; index < migrations.length; index += 1) {
    const currentDate = /^T360-(\d{8})-/.exec(migrations[index])?.[1];
    assert.ok(currentDate, `Migration name lacks a sortable business date: ${migrations[index]}`);
    if (index > 0) {
      const previousDate = /^T360-(\d{8})-/.exec(migrations[index - 1])?.[1];
      assert.ok(previousDate <= currentDate, `Expand migration chronology regressed at ${migrations[index]}`);
    }
  }
}

test('P6A payment schema persists immutable tender/accounting snapshot fields on SQLite and PostgreSQL', () => {
  for (const schema of [sqliteSchema, pgSchema]) {
    const payment = paymentModel(schema);
    for (const field of ['methodName', 'methodReferenceId', 'methodSnapshot', 'settlementAccountCode', 'settlementBehavior', 'feeAmount', 'feeAccountCode']) {
      assert.match(payment, new RegExp(`\\b${field}\\b`));
    }
  }
  assertPaymentMigrationLineage(migrationOrder.migrations);
  for (const provider of ['sqlite', 'postgresql']) {
    const p6aSql = read(`database/migrations/${p6aMigration}/${provider}-expand.sql`);
    const ppobSql = read(`database/migrations/${ppobMigration}/${provider}-expand.sql`);
    for (const field of ['methodName', 'methodReferenceId', 'methodSnapshot', 'settlementAccountCode', 'settlementBehavior', 'feeAmount', 'feeAccountCode']) {
      assert.match(p6aSql, new RegExp(`ALTER TABLE "Payment" ADD COLUMN "${field}"`), `P6A ${provider} migration must persist ${field}`);
    }
    for (const field of ['paymentAccountingEventId', 'settlementAccountingEventId', 'refundAccountingEventId']) {
      assert.match(ppobSql, new RegExp(`ALTER TABLE "DigitalServiceTransaction" ADD COLUMN "${field}"`), `PPOB ${provider} migration must persist ${field}`);
    }
    assert.doesNotMatch(p6aSql, /\bDROP\s+(?:TABLE|COLUMN)\b/i, `P6A ${provider} migration cannot drop history`);
    assert.doesNotMatch(ppobSql, /\bDROP\s+(?:TABLE|COLUMN)\b/i, `PPOB ${provider} migration cannot drop history`);
  }
});

test('negative control: P6A and W2 expand migrations cannot be deleted, reordered, duplicated or backdated', () => {
  const migrations = migrationOrder.migrations;
  assertPaymentMigrationLineage(migrations);
  const invalid = [
    migrations.filter((name) => name !== p6aMigration),
    migrations.filter((name) => name !== ppobMigration),
    [...migrations, ppobMigration],
    migrations.map((name) => name === p6aMigration ? ppobMigration : name === ppobMigration ? p6aMigration : name),
    [...migrations, 'T360-20260901-backdated-append'],
  ];
  for (const mutation of invalid) {
    assert.throws(() => assertPaymentMigrationLineage(mutation), assert.AssertionError);
  }
});

test('P6A tender methods are master-backed and no longer constrained to the legacy four-code enum', () => {
  assert.doesNotMatch(salesDto, /IsIn\(\['CASH',\s*'QRIS',\s*'TRANSFER',\s*'CARD'\]\)/);
  assert.match(sales, /type:\s*'PAYMENT_METHOD'/);
  assert.match(sales, /resolveSalePayments/);
  assert.match(masterData, /normalizeTenderPolicy/);
  assert.match(tenderPolicy, /settlementAccountCode/);
  assert.match(tenderPolicy, /requiresProvider/);
  assert.match(tenderPolicy, /requiresReference/);
  assert.match(tenderPolicy, /feeRatePercent/);
});

test('P6A split and partial tender remain server-authoritative and exact', () => {
  assert.match(sales, /paymentTotal\.equals\(tenderDue\)/);
  assert.match(sales, /Total tender .*tidak sama dengan total transaksi/);
  assert.match(sales, /dto\.onAccount === true/);
  assert.match(sales, /Penjualan piutang wajib memiliki pelanggan/);
  assert.match(sales, /onAccountAmount\.greaterThan\(saleTotal\)/);
  assert.match(sales, /for \(const requested of requestedPayments\)/);
  assert.match(sales, /tx\.payment\.create/);
});

test('P6A accounting routes each tender through the existing accounting event and balanced additional journal lines', () => {
  assert.match(sales, /additionalJournalLines/);
  assert.match(accounting, /additionalJournalLines\?/);
  assert.match(accounting, /debitTotal\.equals\(creditTotal\)/);
  assert.match(accounting, /tidak seimbang/);
  assert.match(sales, /settlementAccountCode/);
  assert.match(sales, /feeAccountCode/);
  assert.match(sales, /paymentBreakdown/);
  assert.match(sales, /netSettlementAmount/);
  assert.doesNotMatch(sales, /journalEntry\.create/);
});

test('P6A customer on-account settlement reuses finance operations with bounded outstanding and idempotent creation', () => {
  assert.match(finance, /referenceType:\s*'Order' \| 'Sale'/);
  assert.match(finance, /payment = sale\.payments\.find\(\(item\) => item\.method === 'ON_ACCOUNT'\)/);
  assert.match(finance, /type:\s*'CUSTOMER_RECEIPT'/);
  assert.match(finance, /beginIdempotent/);
  assert.match(finance, /completeIdempotent/);
  assert.match(finance, /available/);
  assert.match(finance, /Penerimaan pelanggan melebihi piutang tersedia/);
  assert.match(adminAccounting, /referenceType/);
});

test('P6A refunds preserve original tender snapshot and bound receivable reversals to committed settlement state', () => {
  assert.match(returns, /methodSnapshot/);
  assert.match(returns, /refundDetails/);
  assert.match(returns, /resolveSaleRefundAllocations/);
  assert.match(returns, /status:\s*\{ in:\s*\['DRAFT', 'WAITING_APPROVAL', 'APPROVED', 'POSTED', 'PAID'\] \}/);
  assert.match(returns, /Refund ORIGINAL tidak memiliki saldo tender\/piutang/);
  assert.match(returns, /additionalJournalLines/);
});

test('P6A real Admin and POS surfaces expose tender policy, split payment, provider/reference, and on-account controls', () => {
  assert.match(adminMaster, /PAYMENT_METHOD/);
  assert.match(adminMaster, /settlementAccountCode/);
  assert.match(adminMaster, /feeRatePercent/);
  assert.match(pos, /tenderMethods\.map/);
  assert.match(pos, /SPLIT PAYMENT/);
  assert.match(pos, /Piutang pelanggan/);
  assert.match(pos, /Provider pembayaran/);
  assert.match(pos, /Referensi eksternal/);
});

test('P6A browser UAT consumes runtime tender master and refuses missing dynamic POS options without weakening existing UAT', () => {
  assert.match(browserUat, /master-data\/references\?type=PAYMENT_METHOD/);
  assert.match(browserUat, /P6A_TENDER_MASTER_RUNTIME/);
  assert.match(browserUat, /payments:\s*\[\{ method:\s*fixtureTenderCode/);
  assert.match(browserUat, /quantity:\s*quantity \+ 1/);
  assert.match(browserUat, /button\.productMain/);
  assert.match(browserUat, /P6A_POS_CART_TENDER_PREREQUISITE/);
  assert.match(browserUat, /P6A_POS_TENDER_RUNTIME/);
  assert.match(browserUat, /expectedTenderCodes = uatTenderCodes/);
  assert.match(browserUat, /missingTenderCodes\.length/);
  assert.match(browserUat, /hasSplit/);
  assert.match(browserUat, /hasOnAccount/);
  const cartPrerequisite = browserUat.indexOf("id: 'P6A_POS_CART_TENDER_PREREQUISITE'");
  const tenderAssertion = browserUat.indexOf("id: 'P6A_POS_TENDER_RUNTIME'");
  assert.ok(cartPrerequisite > 0 && tenderAssertion > cartPrerequisite, 'POS cart prerequisite must execute before exact tender runtime assertion');
});


test('P6A governance truth is recorded without advancing P5 or Human Stage-20', () => {
  assert.equal(productCompleteness.productReady, false);
  assert.equal(productCompleteness.humanStage20, 'PENDING');
  assert.equal(productCompleteness.currentPhase, 'P5');
  const feature = productCompleteness.features.find((item) => item.key === 'retail_transaction_completion');
  assert.ok(feature, 'P6A feature must be represented in canonical product-completeness truth');
  assert.equal(feature.status, 'IMPLEMENTED_RUNTIME_PENDING');
  assert.equal(p6aWorkItem.module, 'payments');
  assert.equal(p6aWorkItem.wave, 'W2');
  assert.equal(p6aWorkItem.phase, 'VERIFICATION');
  assert.match(featureCatalog, /\| retail_transaction_completion \| on \| implemented-runtime-pending \|/);
});
