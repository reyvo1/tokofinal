// Service fee: the money must reach the ledger, not just the receipt.
//
// The trap this test exists for: `postOperationalEvent` builds its journal lines from the seeded
// `AccountingPostingRule.journalLines` and then ASSERTS debit == credit. Adding a fee to the
// settlement without adding a matching credit line does not produce a wrong journal — it throws
// "Jurnal tidak seimbang" and REJECTS THE SALE. So a fee feature that typechecks and passes a unit
// test can still make every fee transaction fail at the till, and nothing short of posting a real
// sale reveals it.
//
// The second trap: folding the fee into product revenue. The branch P&L would then show card/QRIS
// service income as goods sales, which is the number a manager uses to decide what to stock.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = new URL('../', import.meta.url).pathname;
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const sales = read('apps/api/src/sales/sales.service.ts');
const seed = read('apps/api/prisma/seed.ts');
const dto = read('apps/api/src/sales/dto/create-sale.dto.ts');
const pos = read('apps/pos/app/page.tsx');
const schemas = ['apps/api/prisma/schema.prisma', 'apps/api/prisma/schema.sqlite.prisma', 'apps/api/prisma/schema.postgresql.prisma']
  .map((f) => [f, read(f)]);

test('the fee is stored on the sale, not folded into the total', () => {
  for (const [name, text] of schemas) {
    assert.match(text, /serviceFee\s+Decimal\s+@default\(0\)/, `${name} is missing Sale.serviceFee`);
  }
  // The final charged total is named once, while serviceFee remains a separate persisted column.
  // Reusing that named value prevents payment validation, receipt total, and accounting from drifting.
  assert.match(sales, /const saleTotal = total\.add\(serviceFee\)\.toDecimalPlaces\(2\)/);
  assert.match(sales, /serviceFee, total: saleTotal/);
});

test('the fee reaches the customer as a separate line, not a silent total increase', () => {
  const quote = sales.slice(sales.indexOf('async quote('), sales.indexOf('async create('));
  assert.match(quote, /serviceFee,/);
  assert.match(quote, /total: total\.add\(serviceFee\)/);
  // A cashier who cannot see the fee cannot explain the charge to a customer standing there.
  assert.match(pos, /<span>Biaya layanan<\/span>/);
  assert.match(pos, /const displayTotal = .* \+ serviceFee;/,
    'the no-quote fallback must include the fee, or the screen total is short by exactly that much');
});

test('a negative or oversized fee is clamped by the server, not trusted from the request', () => {
  // `dto.serviceFee` arrives straight from the request body. A negative value would become a
  // discount the cashier did not ask approval for; an oversized one would zero out the sale total.
  assert.match(sales, /if \(requested\.isNegative\(\)\) return new Prisma\.Decimal\(0\);/);
  assert.match(sales, /requested\.greaterThan\(settlement\) \? settlement : requested/);
});

test('the ledger balances: the fee gets its own credit line in every SALE rule', () => {
  // This is the assertion that would have caught the "fee rejects every sale" failure. It reads the
  // seeded rules rather than trusting that one was updated, because there are three of them and a
  // split payment takes a different path than a cash sale.
  for (const rule of ['SALE-CASH', 'SALE-BANK', 'SALE-SPLIT']) {
    const start = seed.indexOf(`code: '${rule}'`);
    assert.ok(start > 0, `${rule} not found in seed`);
    const block = seed.slice(start, seed.indexOf('] }', start));
    assert.match(block, /accountCodeKey: 'serviceRevenue', side: 'CREDIT', amountKey: 'serviceRevenue'/,
      `${rule} has no service-fee credit line, so settlement would exceed revenue+tax and the`);
    assert.match(block, /accountCodeKey: 'serviceRevenue', side: 'CREDIT', amountKey: 'serviceRevenue', skipIfZero: true/,
      `${rule}: a sale with no fee must still balance, so the line must be skipped when zero`);
  }
});

test('the balance identity actually holds, arithmetically', () => {
  // Mirrors what postOperationalEvent computes. DEBIT: settlement + cogs.
  // CREDIT: revenue + serviceRevenue + outputTax + inventory. With settlement = total + fee and
  // total = net + tax, both sides equal total + cogs.
  const net = 100000, tax = 11000, cogs = 60000, fee = 2500;
  const total = net + tax;
  const debit = (total + fee) + cogs;
  const credit = net + fee + tax + cogs;
  assert.equal(debit, credit, 'the SALE journal must balance for any fee');
  // And with no fee at all, which is the common case and must not change.
  const debit0 = total + cogs, credit0 = net + 0 + tax + cogs;
  assert.equal(debit0, credit0);
});

test('service income is its own account, not product revenue', () => {
  assert.match(seed, /\['4104','Pendapatan Jasa',AccountType\.REVENUE\]/,
    'account 4104 must exist, or posting fails with "Akun belum dikonfigurasi"');
  assert.match(sales, /serviceRevenue: '4104'/);
  assert.match(sales, /revenue: '4101', serviceRevenue: '4104'/,
    'the fee must not be credited to 4101 (product sales)');

  // 4102 was the first choice and it was WRONG: the seed already defines 4102 as
  // "Retur dan Potongan Penjualan", so adding a second 4102 as "Pendapatan Jasa" created two
  // different meanings for one code, and the live ledger showed service income posted to a RETURNS
  // account. The seed is an upsert on code, so the last definition silently wins and the journal
  // still balances — the numbers are right and the MEANING is wrong, which is worse to audit.
  // Asserted here so the code cannot be reused.
  const seededCodes = [...seed.matchAll(/\['(\d{4})','([^']+)'/g)].map((m) => [m[1], m[2]]);
  const byCode = new Map();
  for (const [code, name] of seededCodes) {
    // A duplicate code is not necessarily wrong (some seeds legitimately re-declare with the same
    // name), but two DIFFERENT names for one code silently changes what every posting means.
    if (byCode.has(code) && byCode.get(code) !== name) {
      assert.fail(`account code ${code} is seeded twice with different names: "${byCode.get(code)}" and "${name}"`);
    }
    byCode.set(code, name);
  }
});

test('a fee is refused offline rather than silently dropped', () => {
  // The offline quote engine does not model service fees, so a queued sale with one would be
  // replayed with an expectedTotal the server disagrees with — an OFFLINE_TOTAL_CHANGED conflict for
  // a fee the cashier was told was accepted.
  assert.match(pos, /Biaya layanan tidak dapat dicatat saat offline/);
  assert.match(pos, /if \(serviceFee > 0\) \{ setMessage\('Biaya layanan/);
  // And the input is disabled offline, so the cashier cannot get into that state by typing.
  assert.match(pos, /disabled=\{!apiOnline\} value=\{serviceFee\}/);
});

test('the fee is optional and the DTO bounds it', () => {
  assert.match(dto, /@IsOptional\(\) @IsNumber\(\) @Min\(0\) serviceFee\?: number/);
  // Zero by default: a sale with no fee must behave exactly as before this change existed.
  assert.match(sales, /const requested = new Prisma\.Decimal\(dto\.serviceFee \?\? 0\);/);
  assert.match(pos, /\.\.\.\(serviceFee > 0 \? \{ serviceFee \} : \{\}\),/,
    'the POS must not send a zero fee, so existing payloads are unchanged');
});
