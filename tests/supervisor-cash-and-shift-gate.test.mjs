// Two of the five PrivilegedActions had no gate at all.
//
// `grep` found no `consume()` call for SALE_CASH_MOVEMENT or SHIFT_CLOSE, and that was TRUE: a
// cashier could take the drawer with nothing but a free-text reason. Probed live before the fix, as
// a CASHIER: CASH_OUT of Rp 2.500.000 returned 201, and closing with Rp 1 declared against a drawer
// short Rp 2.311.201 also returned 201 — the loss was recorded in a column and the shift closed
// anyway.
//
// SALE_PRICE_OVERRIDE is the opposite case and is asserted here so it is not "fixed" by mistake: the
// DTO has no unitPrice and the global ValidationPipe sets forbidNonWhitelisted, so a client cannot
// dictate a price. There is nothing to override, and adding a gate to an unreachable path would be
// theatre.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = new URL('../', import.meta.url).pathname;
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const sales = read('apps/api/src/sales/sales.service.ts');
const controller = read('apps/api/src/sales/sales.controller.ts');
const dto = read('apps/api/src/sales/dto/create-sale.dto.ts');
const main = read('apps/api/src/main.ts');
const pos = read('apps/pos/app/page.tsx');
const approval = read('apps/api/src/supervisor-approval/supervisor-approval.service.ts');

const body = (marker) => {
  const start = sales.indexOf(marker);
  assert.ok(start >= 0, `could not find ${marker} in sales.service.ts`);
  return sales.slice(start);
};

test('taking cash out of the drawer above the threshold needs a supervisor grant', () => {
  assert.match(sales, /const SUPERVISOR_CASH_MOVEMENT_RATIO = new Prisma\.Decimal\('0\.05'\)/,
    'the threshold must be a fixed constant — a per-branch cash cap is a per-branch fraud setting');
  const movement = body('async recordCashMovement(');
  assert.match(movement, /if \(dto\.type === 'CASH_OUT'\)/,
    'only money LEAVING the drawer is gated; petty cash added for change must stay a cashier action');
  assert.match(movement, /this\.approvals\.consume\(grantId, 'SALE_CASH_MOVEMENT', user\)/,
    'the grant must be spent at the point of use');

  // The refusal itself needs its own assertion, positioned so it cannot be satisfied by a consume
  // that runs unconditionally. `assert.match(/if \(!grantId\)/)` was the first attempt and it went
  // GREEN with the refusal deleted — because the surviving `consume` line still matched everything
  // around it. Require the refusal and the spend to sit inside the SAME threshold branch, and require
  // the throw to be the one that ends that branch.
  const cashGate = movement.slice(
    movement.indexOf("if (dto.type === 'CASH_OUT')"),
    movement.indexOf("const movement = await tx.cashierCashMovement.create("),
  );
  assert.match(cashGate, /if \(!grantId\)\s*\{\s*throw new ForbiddenException\(\s*'Pengambilan kas[^']*'\s*\)/,
    'above the threshold and with no grant, the movement must be REFUSED');
  assert.match(cashGate, /if \(float\.greaterThan\(0\) && amount\.dividedBy\(float\)\.greaterThan\(SUPERVISOR_CASH_MOVEMENT_RATIO\)\)/,
    'and the refusal must be inside the threshold test, not merely somewhere in the method');
  // Ordering: the refusal must come BEFORE the consume, or the grant is spent and the request still
  // proceeds. `matchAll` and take the last occurrence — indexOf would find the wrong one.
  const throwAt = cashGate.lastIndexOf('throw new ForbiddenException');
  const consumeAt = cashGate.indexOf("this.approvals.consume(grantId, 'SALE_CASH_MOVEMENT'");
  assert.ok(throwAt > -1 && consumeAt > throwAt,
    `the refusal must precede the spend (throw@${throwAt}, consume@${consumeAt})`);
  // The yardstick is the float, not a fixed rupiah figure: 5% of a warung float is petty cash.
  assert.match(movement, /const float = new Prisma\.Decimal\(shift\.openingCash\)/);
});

test('closing a shift that does not reconcile needs a supervisor grant', () => {
  assert.match(sales, /const SUPERVISOR_SHIFT_DIFFERENCE_TOLERANCE = 10000;/,
    'a small shortfall is ordinary change error and must not summon a manager');
  const close = body('async closeShift(');
  assert.match(close, /const shortfall = expected - closingCash;/);
  assert.match(close, /if \(shortfall > SUPERVISOR_SHIFT_DIFFERENCE_TOLERANCE\)/,
    'gate the SHORT side only: a drawer that comes up over must never be blocked, or this control');
  // ...becomes a way to stop a till from closing. Assert the sign, not just the presence of a check.
  const shiftGate = close.slice(close.indexOf('if (shortfall > SUPERVISOR_SHIFT_DIFFERENCE_TOLERANCE)'),
    close.indexOf('const row = await tx.cashierShift.update('));
  assert.match(shiftGate, /if \(!grantId\)\s*\{\s*throw new ForbiddenException/,
    'a shortfall past the tolerance with no grant must be REFUSED, not recorded');
  assert.match(shiftGate, /this\.approvals\.consume\(grantId, 'SHIFT_CLOSE', user\)/);
  assert.doesNotMatch(close, /closingCash\s*-\s*expected\s*>\s*SUPERVISOR_SHIFT_DIFFERENCE_TOLERANCE/,
    'gating an OVERAGE would block a safe outcome — that is the opposite of the intent');
});

test('both gates sit on the commit path and both reach the service', () => {
  // A gate that lives only in a preview or a UI is not a gate. The service is the boundary.
  assert.match(controller, /this\.sales\.closeShift\(user, dto\.closingCash, dto\.supervisorApprovalId\)/);
  assert.match(controller, /this\.sales\.recordCashMovement\(user, dto, dto\.supervisorApprovalId\)/);
  // The grant has to survive the DTO, or forbidNonWhitelisted turns a legitimate approval into a 400.
  assert.match(dto, /supervisorApprovalId\?: string/);
  const grantFields = (dto.match(/supervisorApprovalId\?: string/g) ?? []).length;
  assert.ok(grantFields >= 3,
    `CreateSaleDto, CloseCashierShiftDto and CashierCashMovementDto must all carry the grant (found ${grantFields})`);
  assert.match(main, /forbidNonWhitelisted: true/,
    'the guard that makes a missing DTO field a hard 400 rather than a silent drop');
});

test('the grant is single-use and action-scoped, so it cannot be spent twice', () => {
  assert.match(approval, /this\.grants\.delete\(grantId\);/);
  assert.match(approval, /if \(grant\.action !== action\)/);
  // A SHIFT_CLOSE grant must not open the drawer, and a cash grant must not close a shift.
  assert.match(sales, /consume\(grantId, 'SALE_CASH_MOVEMENT', user\)/);
  assert.match(sales, /consume\(grantId, 'SHIFT_CLOSE', user\)/);
});

test('a cashier can ASK for approval, so the gate is satisfiable', () => {
  // The failure mode of a control with no path: the till says "needs supervisor" and offers nothing.
  // This was exactly the shape of the original defect — an endpoint nobody could satisfy.
  assert.match(pos, /SALE_CASH_MOVEMENT/);
  assert.match(pos, /SHIFT_CLOSE/);
  assert.match(pos, /Minta persetujuan supervisor/);
  assert.match(pos, /supervisor\.open\(/);
  assert.match(pos, /supervisorApprovalId/,
    'and the grant obtained must reach the request');
});

test('the RETRY spends the grant the PIN prompt just produced', () => {
  // This assertion is the one that was missing, and its absence let a real bug ship in the first
  // version of this gate: the click was refused, the dialog opened, the PIN was accepted, and the
  // second click called `post()` with NO grant — so the till refused forever. A dialog that returns
  // a grant nobody reads is the same defect as no dialog at all, and it survived a source-level test
  // that only checked the grant could reach the request in principle.
  const cash = pos.slice(pos.indexOf('async function recordCashMovement('),
    pos.indexOf('async function submitSaleReturn('));
  const takenAt = cash.indexOf('supervisor.takeGrant()');
  const postAt = cash.indexOf('await post(');
  assert.ok(takenAt > -1,
    'recordCashMovement must consume the held grant; otherwise the PIN is collected and discarded');
  assert.ok(takenAt < postAt,
    `takeGrant() must happen BEFORE the request (take@${takenAt}, post@${postAt})`);
  assert.match(cash, /await post\(heldGrant \?\? undefined\)/,
    'and the grant must be the argument actually sent, not a local that is then dropped');
  // The same trap in the shift-close path, which already reads the grant before posting. Slice to the
  // NEXT function rather than to a named one: closeShift is declared AFTER recordCashMovement, so an
  // indexOf() between the two produces an empty range and the assertion below fails for the wrong
  // reason — which is how a passing-looking test can check nothing.
  const closeStart = pos.indexOf('async function closeShift(');
  assert.ok(closeStart > 0, 'closeShift is not in the POS at all');
  const nextFn = pos.indexOf('async function ', closeStart + 10);
  const close = pos.slice(closeStart, nextFn > 0 ? nextFn : closeStart + 2500);
  assert.ok(close.includes('supervisor.takeGrant()'),
    'closeShift must consume the held grant too');
  assert.ok(close.includes('supervisorApprovalId'),
    'and send it with the close request');
  assert.ok(close.indexOf('supervisor.takeGrant()') < close.indexOf('api<'),
    'the grant must be read before the request is sent');
});

test('a held grant is single-use in the till, not a standing permission', () => {
  // takeGrant() clears the held grant as it reads it, so approving once cannot silently authorise
  // every later withdrawal in the same session.
  const helper = read('apps/pos/lib/supervisor.ts');
  const take = helper.slice(helper.indexOf('const takeGrant'), helper.indexOf('const takeGrant') + 320);
  assert.match(take, /setGrant\(null\)/,
    'reading the grant must forget it');
  assert.doesNotMatch(helper, /localStorage[^\n]*grant|setItem\([^)]*grant/i,
    'a grant must never outlive the component — that would be a standing permission');
});

test('price override stays impossible — the guard is the DTO, not a supervisor prompt', () => {
  // Asserting this prevents a future wave from "adding" a gate to a path that cannot be reached.
  const saleItemDto = dto.slice(dto.indexOf('class SaleItemDto'), dto.indexOf('class SalePaymentDto'));
  assert.doesNotMatch(saleItemDto, /unitPrice/,
    'a client-supplied unitPrice would let a caller dictate the price of a line');
  assert.match(main, /forbidNonWhitelisted: true/,
    'so sending one is a hard 400, not a silently ignored field');
});
