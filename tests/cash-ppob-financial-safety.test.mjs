import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const sales = source('apps/api/src/sales/sales.service.ts');
const dto = source('apps/api/src/sales/dto/create-sale.dto.ts');
const pos = source('apps/pos/app/page.tsx');
const ppob = source('apps/api/src/digital-services/digital-services.service.ts');
const supervisor = source('apps/api/src/supervisor-approval/supervisor-approval.service.ts');

function movementBody(sourceText) {
  return sourceText.slice(sourceText.indexOf('async recordCashMovement('), sourceText.indexOf('async openShift('));
}

function verifyCashSafety(sourceText) {
  const body = movementBody(sourceText);
  const guard = body.slice(body.indexOf("if (dto.type === 'CASH_OUT')"), body.indexOf('const movement = await tx.cashierCashMovement.create('));
  assert.match(guard, /\.plus\(summary\.cashIn\)\s*\.minus\(summary\.cashRefunds\)\s*\.minus\(summary\.cashOut\)/,
    'previous cash withdrawals must reduce available drawer cash');
  assert.match(guard, /if \(float\.isNegative\(\) \|\| amount\.greaterThan\(float\)\)\s*\{\s*throw new BadRequestException\(/,
    'overdraft must be rejected, not merely escalated to supervisor');
  const overdraft = guard.indexOf('if (float.isNegative() || amount.greaterThan(float))');
  const approval = guard.indexOf('this.approvals.consume(');
  assert.ok(overdraft >= 0 && approval > overdraft, 'overdraft fails before consuming supervisor grant');
  assert.match(body, /serializableTx\(this\.prisma/);
}

test('cash-out uses remaining drawer balance and hard rejects overdrafts before supervisor permission', () => {
  verifyCashSafety(sales);
  assert.throws(() => verifyCashSafety(sales.replace('.minus(summary.cashOut)', '')), /previous cash withdrawals/);
  assert.throws(() => verifyCashSafety(sales.replace('amount.greaterThan(float)', 'false')), /overdraft/);
  assert.throws(() => verifyCashSafety(sales.replace('float.isNegative() || amount.greaterThan(float)', 'false')), /overdraft/);
});

test('cash movement uses existing transactional receipts, with strict payload and after-close replay', () => {
  const body = movementBody(sales);
  const begin = body.indexOf('await beginIdempotent(');
  const shift = body.indexOf('const shift = await tx.cashierShift.findFirst(');
  const create = body.indexOf('const movement = await tx.cashierCashMovement.create(');
  const complete = body.indexOf('await completeIdempotent(');
  assert.ok(begin > 0 && begin < shift && shift < create && create < complete,
    'replay must work after shift closes and receipt must finalize after the movement');
  assert.match(body, /const idempotencyScope = `cashier-cash-movement:\$\{user\.sub\}`/);
  assert.match(body, /payload: \{ branchId: scope\.branchId, type: dto\.type, amount: new Prisma\.Decimal\(dto\.amount\)\.toFixed\(2\), reason \}/);
  assert.match(body, /if \(replay\.replay\)/);
  assert.match(body, /resourceType: 'CashierCashMovement', resourceId: movement\.id, response: movement/);
  assert.doesNotMatch(body.slice(begin, shift), /supervisorApprovalId|grantId/,
    'supervisor grant is transport authorization, not a mutation of the financial request');
  assert.match(dto, /class CashierCashMovementDto \{\s*@ApiProperty\([^)]*Kunci unik[^)]*\)\s*@IsString\(\) @MinLength\(8\) @MaxLength\(160\) idempotencyKey!: string;/);
});

test('cash amount precision is validated before idempotency hashing and financial writes', () => {
  const body = movementBody(sales);
  const validation = body.slice(0, body.indexOf('return serializableTx('));
  assert.match(dto, /@IsNumber\(\{ maxDecimalPlaces: 2 \}\) @Min\(0\.01\) amount!: number;/);
  assert.match(validation, /new Prisma\.Decimal\(dto\.amount\)\.decimalPlaces\(\) > 2/);
  assert.match(validation, /new Prisma\.Decimal\(dto\.amount\)\.greaterThanOrEqualTo\('0\.01'\)/);
  assert.ok(validation.indexOf('decimalPlaces() > 2') < body.indexOf('await beginIdempotent('));
  assert.match(pos, /type="number" min="0\.01" step="0\.01" value=\{cashMovementAmount\}/);
  assert.throws(() => assert.match(validation.replace('.decimalPlaces() > 2', '.decimalPlaces() > 99'),
    /new Prisma\.Decimal\(dto\.amount\)\.decimalPlaces\(\) > 2/));
});

test('supervisor grants use unique opaque keys and exact operator/branch scoping at consumption', () => {
  const consume = supervisor.slice(supervisor.indexOf('  consume(grantId:'), supervisor.indexOf('  /** Which privileged actions'));
  assert.match(supervisor, /import \{ randomUUID \} from 'node:crypto';/);
  assert.match(supervisor, /const grantId = randomUUID\(\);/);
  assert.match(supervisor, /operatorId: user\.sub,/);
  assert.match(supervisor, /branchId: user\.branchId \?\? '',/);
  assert.match(consume, /grant\.companyId !== user\.companyId/);
  assert.match(consume, /grant\.branchId !== user\.branchId \|\| grant\.operatorId !== user\.sub/);
  // The first delete is the expired-token cleanup; the last delete spends the valid grant.
  assert.ok(consume.indexOf('grant.branchId !== user.branchId') < consume.lastIndexOf('this.grants.delete(grantId);'));
  assert.throws(() => assert.match(consume.replace('grant.operatorId !== user.sub', 'false'),
    /grant\.branchId !== user\.branchId \|\| grant\.operatorId !== user\.sub/));
});

test('POS preserves the same operation key across failed network calls and supervisor retry', () => {
  const body = pos.slice(pos.indexOf('async function recordCashMovement('), pos.indexOf('async function submitSaleReturn('));
  assert.match(pos, /cashMovementOperationRef = useRef<\{ fingerprint: string; key: string \} \| null>/);
  assert.match(body, /const fingerprint = JSON\.stringify\(\[shift\.id, type, cashMovementAmount, cashMovementReason\.trim\(\)\]\)/);
  assert.match(body, /cashMovementOperationRef\.current\?\.fingerprint !== fingerprint/);
  assert.match(body, /key: crypto\.randomUUID\(\)/);
  assert.match(body, /body: JSON\.stringify\(\{ idempotencyKey, type, amount:/);
  assert.match(body, /await post\(heldGrant \?\? undefined\)/);
  const cleared = body.indexOf('cashMovementOperationRef.current = null;');
  assert.ok(cleared > body.indexOf('await post(heldGrant ?? undefined)'), 'successful response must consume pending key');
  assert.doesNotMatch(body.slice(body.indexOf('} catch (error) { setMessage'), body.length), /cashMovementOperationRef\.current = null/,
    'uncertain response must NOT destroy the retry key');
});

function verifyPpobReplay(sourceText) {
  const body = sourceText.slice(sourceText.indexOf('async createTransaction('), sourceText.indexOf('async recheck('));
  const check = body.slice(body.indexOf('if (existing) {'), body.indexOf('return existing;'));
  assert.match(check, /existing\.branchId !== scope\.branchId \|\| existing\.requestedById !== user\.sub/);
  assert.match(check, /throw new NotFoundException/);
  assert.match(check, /existing\.providerSku !== dto\.providerSku\.trim\(\)/);
  assert.match(check, /existing\.customerNo !== dto\.customerNo\.trim\(\)/);
  assert.match(check, /!priceMatches/);
  assert.match(body, /requestedMaxPrice: dto\.maxPrice == null \? null : new Prisma\.Decimal\(dto\.maxPrice\)\.toString\(\)/);
  assert.match(body, /serializableTx\(this\.prisma/);
}

test('PPOB idempotent replay rejects different branch, operator, SKU, destination and price', () => {
  verifyPpobReplay(ppob);
  assert.throws(() => verifyPpobReplay(ppob.replace('existing.branchId !== scope.branchId || ', '')), /branchId/);
  assert.throws(() => verifyPpobReplay(ppob.replace('existing.customerNo !== dto.customerNo.trim() || ', '')), /customerNo/);
  assert.throws(() => verifyPpobReplay(ppob.replace('|| !priceMatches', '')), /priceMatches/);
});
