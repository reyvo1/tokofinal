import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const service = read('apps/api/src/sales/sales.service.ts');
const rule = read('apps/api/src/sales/cash-drawer-posting.ts');
const dto = read('apps/api/src/sales/dto/create-sale.dto.ts');
const pos = read('apps/pos/app/page.tsx');
const shift = service.slice(service.indexOf('async closeShift('), service.indexOf('async shiftRecap('));
const movement = service.slice(service.indexOf('async recordCashMovement('), service.indexOf('async openShift('));

function checkLedger(source) {
  assert.match(source, /await this\.accounting\.postOperationalEvent\(tx,\s*\{/);
  assert.match(source, /sourceType: 'CashierCashMovement', sourceId: movement\.id/);
  assert.match(source, /idempotencyKey: `cash-drawer:\$\{movement\.id\}`/);
  assert.match(source, /accountCodes: \{ drawerCash: DRAWER_ACCOUNT_CODE \}/);
  assert.ok(source.indexOf('await assertCashDrawerPostingRule(') < source.indexOf('const movement = await tx.cashierCashMovement.create('));
  assert.ok(source.indexOf('await this.accounting.postOperationalEvent(') < source.indexOf('await completeIdempotent('));
}

test('cash drawer movement and Accounting Core journal are one atomic serializable transaction', () => {
  assert.match(movement, /return serializableTx\(this\.prisma, async \(tx\) => \{/);
  checkLedger(movement);
  assert.throws(() => checkLedger(movement.replace('await this.accounting.postOperationalEvent(tx, {', 'await tx.eventOutbox.create({')), /postOperationalEvent/);
  assert.throws(() => checkLedger(movement.replace('accountCodes: { drawerCash: DRAWER_ACCOUNT_CODE }', 'accountCodes: {}')), /drawerCash/);
});

test('existing pre-W3 movement receipts never silently replay without matching posted journals', () => {
  const replay = movement.slice(movement.indexOf('if (replay.replay)'), movement.indexOf('const shift = await tx.cashierShift.findFirst('));
  assert.match(replay, /await tx\.accountingEvent\.findFirst\(/);
  assert.match(replay, /eventType,\s*sourceType: 'CashierCashMovement', sourceId: old\.id, status: 'POSTED'/);
  assert.match(replay, /!posted \|\| !new Prisma\.Decimal\(posted\.grossAmount\)\.equals\(dto\.amount\)/);
  assert.throws(() => assert.match(replay.replace("status: 'POSTED'", "status: 'PENDING'"), /status: 'POSTED'/));
});

test('GL posting is fail-closed on missing active finance rules, wrong accounts and non-transfer cash', () => {
  assert.match(rule, /companyId: scope\.companyId, eventType, status: 'ACTIVE'/);
  assert.match(rule, /branchId: scope\.branchId, code: \{ in: \[DRAWER_ACCOUNT_CODE, oppositeCode\] \}, isActive: true, branch: \{ companyId: scope\.companyId \}/);
  assert.match(rule, /CASH_DRAWER_TRANSFER_IN: \{ drawerSide: 'DEBIT', oppositeSide: 'CREDIT', oppositeType: 'ASSET' \}/);
  assert.match(rule, /CASH_DRAWER_TRANSFER_OUT: \{ drawerSide: 'CREDIT', oppositeSide: 'DEBIT', oppositeType: 'ASSET' \}/);
  assert.match(rule, /Akun kas laci 1101 ASSET/i);
  assert.match(rule, /value\.length !== 2/);
  assert.match(rule, /line\.accountCode\.trim\(\)\.toUpperCase\(\) === DRAWER_ACCOUNT_CODE/);
  assert.match(rule, /code === DRAWER_ACCOUNT_CODE/);
  assert.match(rule, /amountKey !== 'gross'/);
  assert.throws(() => assert.match(rule.replace("CASH_DRAWER_TRANSFER_IN: { drawerSide: 'DEBIT', oppositeSide: 'CREDIT', oppositeType: 'ASSET' }", "CASH_DRAWER_TRANSFER_IN: { drawerSide: 'DEBIT', oppositeSide: 'CREDIT', oppositeType: 'EXPENSE' }"), /CASH_DRAWER_TRANSFER_IN: \{ drawerSide: 'DEBIT', oppositeSide: 'CREDIT', oppositeType: 'ASSET' \}/));
});

test('shortage and overage close only after journalled variance; no journal on exact match', () => {
  assert.match(shift, /const difference = declared\.minus\(expected\);/);
  assert.match(shift, /if \(!difference\.isZero\(\)\) \{/);
  assert.match(shift, /difference\.isNegative\(\) \? 'CASHIER_SHIFT_SHORT' : 'CASHIER_SHIFT_OVER'/);
  assert.match(shift, /await assertCashDrawerPostingRule\(tx, scope, eventType, postingAt\)/);
  assert.match(shift, /await this\.accounting\.postOperationalEvent\(tx,\s*\{/);
  assert.match(shift, /sourceType: 'CashierShift', sourceId: shift\.id/);
  assert.match(shift, /idempotencyKey: `cash-shift-variance:\$\{shift\.id\}`/);
  assert.ok(shift.indexOf('await this.accounting.postOperationalEvent(') < shift.indexOf('const row = await tx.cashierShift.update('));
  assert.match(rule, /CASHIER_SHIFT_SHORT: \{ drawerSide: 'CREDIT', oppositeSide: 'DEBIT', oppositeType: 'EXPENSE' \}/);
  assert.match(rule, /CASHIER_SHIFT_OVER: \{ drawerSide: 'DEBIT', oppositeSide: 'CREDIT', oppositeType: 'REVENUE' \}/);
  assert.throws(() => assert.match(shift.replace("'CASHIER_SHIFT_SHORT'", "'CASHIER_SHIFT_OVER'"), /difference\.isNegative\(\) \? 'CASHIER_SHIFT_SHORT' : 'CASHIER_SHIFT_OVER'/));
});

test('no 3+ fractional digits on opening or closing cash and GL amounts', () => {
  assert.match(dto, /@IsNumber\(\{ maxDecimalPlaces: 2 \}\) @Min\(0\) openingCash!: number;/);
  assert.match(dto, /@IsNumber\(\{ maxDecimalPlaces: 2 \}\) @Min\(0\) closingCash!: number;/);
  assert.match(shift, /new Prisma\.Decimal\(closingCash\)\.decimalPlaces\(\) > 2/);
  assert.match(service, /new Prisma\.Decimal\(openingCash\)\.decimalPlaces\(\) > 2/);
  assert.match(shift, /\.toDecimalPlaces\(2\)/);
});

test('cashier cannot choose ledger account; POS distinguishes GL transfer from expense', () => {
  assert.doesNotMatch(dto.slice(dto.indexOf('export class CashierCashMovementDto'),dto.indexOf('export class OfflineSaleReplayItemDto')), /accountCode|journal/);
  assert.match(pos, /Transfer kas laci ↔ kas penyimpanan \(bukan biaya\)/);
  assert.match(pos, />KAS MASUK<\/button>/);
  assert.match(pos, />KAS KELUAR<\/button>/);
  const admin = read('apps/admin/app/modules/accounting.tsx');
  assert.match(admin, /accountCode: accountRaw\.toUpperCase\(\)/, 'source authority for Finance account configuration');
});

// Execute the REAL authored rule validator (not a copied implementation) with Node's built-in
// type erasure. No Nest/Prisma install or database fixture is required for these negative controls.
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';

function liveRuleValidator() {
  const emitted = stripTypeScriptTypes(rule.replace(/^import .*?;\s*$/gm, '')
    .replace(/\bexport\s+(?=(const|function|async|type)\b)/g, ''));
  const context = { BadRequestException: class BadRequestException extends Error {} };
  runInNewContext(emitted, context, { timeout: 1000 });
  return context;
}

const cases = [
  ['CASH_DRAWER_TRANSFER_IN', 'DEBIT', 'CREDIT', 'ASSET'],
  ['CASH_DRAWER_TRANSFER_OUT', 'CREDIT', 'DEBIT', 'ASSET'],
  ['CASHIER_SHIFT_SHORT', 'CREDIT', 'DEBIT', 'EXPENSE'],
  ['CASHIER_SHIFT_OVER', 'DEBIT', 'CREDIT', 'REVENUE'],
];

for (const [eventType, drawerSide, oppositeSide, oppositeType] of cases) {
  test(`executed finance rule rejects missing/wrong GL semantics for ${eventType}`, async () => {
    const { inspectCashDrawerPostingRule, assertCashDrawerPostingRule } = liveRuleValidator();
    const makeLines = () => [
      { accountCodeKey: 'drawerCash', side: drawerSide, amountKey: 'gross' },
      { accountCode: '1199', side: oppositeSide, amountKey: 'gross' },
    ];
    assert.equal(inspectCashDrawerPostingRule(eventType, makeLines()), '1199');
    const literalLines = [{ accountCode: '1101', side: drawerSide, amountKey: 'gross' }, makeLines()[1]];
    assert.equal(inspectCashDrawerPostingRule(eventType, literalLines), '1199', 'Finance Admin literal-account editor must work');
    const variants = [
      [],
      [makeLines()[0]],
      [makeLines()[0], { ...makeLines()[1], amountKey: 'net' }],
      [{ ...makeLines()[0], side: oppositeSide }, makeLines()[1]],
      [makeLines()[0], { ...makeLines()[1], accountCode: '1101' }],
      [makeLines()[0], { ...makeLines()[1], accountCodeKey: 'cashierSelectedAccount' }],
    ];
    for (const invalid of variants) assert.throws(() => inspectCashDrawerPostingRule(eventType, invalid));
    const tx = {
      accountingPostingRule: { findFirst: async () => ({ journalLines: makeLines() }) },
      account: { findMany: async () => [
        { code: '1101', type: 'ASSET' }, { code: '1199', type: oppositeType },
      ] },
    };
    await assertCashDrawerPostingRule(tx, { companyId: 'company-1', branchId: 'branch-1' }, eventType, new Date());
    tx.account.findMany = async () => [
      { code: '1101', type: 'ASSET' }, { code: '1199', type: 'LIABILITY' },
    ];
    await assert.rejects(() => assertCashDrawerPostingRule(tx, { companyId: 'company-1', branchId: 'branch-1' }, eventType, new Date()));
    tx.accountingPostingRule.findFirst = async () => null;
    await assert.rejects(() => assertCashDrawerPostingRule(tx, { companyId: 'company-1', branchId: 'branch-1' }, eventType, new Date()));
  });
}
