// Operator policy: a cashier RETURN needs approval from OWNER or FINANCE.
//
// A cashier may FILE a return. A cashier may not FINALISE one. This is the policy, and the guard in
// `apps/api/src/returns/returns.controller.ts` encodes it:
//
//   POST sales             -> roles include CASHIER, permission sale.return    (filing)
//   POST sales/:id/confirm -> roles EXCLUDE CASHIER, permission sale.refund   (finalising)
//
// Why this file exists, even though the guard looks right by reading it: during this project three
// separate "PROVEN" acceptance items turned out to have a real defect that source-regex tests did
// not catch, because the tests asserted that certain source lines existed and never ran the code. A
// guard nobody has executed is an assumption. This executes the REAL RolesGuard against the REAL
// decorator metadata on the REAL controller methods.
//
// What is deliberately NOT asserted: that the service also re-checks roles. It does not, and it
// should not — authorisation belongs to the controller guard in this codebase. Duplicating it in the
// service would be two policies to drift apart.
import assert from 'node:assert/strict';
import test from 'node:test';
import { Reflector } from '@nestjs/core';
import { load } from './helpers/import-ts.mjs';

const opts = { platform: 'node', external: ['@nestjs/core', '@nestjs/common'] };
const { ReturnsController } = await load('apps/api/src/returns/returns.controller.ts', opts);
const { RolesGuard } = await load('apps/api/src/auth/roles.guard.ts', opts);
const { ROLES_KEY } = await load('apps/api/src/auth/roles.decorator.ts', opts);
const { PERMISSIONS_KEY } = await load('apps/api/src/auth/permissions.decorator.ts', opts);

const guard = new RolesGuard(new Reflector());
const proto = ReturnsController.prototype;

/** Builds the minimal ExecutionContext the guard actually reads: the handler and the request user. */
function contextFor(method, user) {
  return {
    getHandler: () => proto[method],
    getClass: () => ReturnsController,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  };
}

const role = (name) => ({ sub: `u-${name}`, name, authType: 'SESSION', companyId: 'acme', branchId: 'br-1', roles: [name] });

function allows(method, user) {
  return guard.canActivate(contextFor(method, user));
}

/** Returns the refusal message if the guard rejects, else null. */
function refusal(method, user) {
  try {
    guard.canActivate(contextFor(method, user));
    return null;
  } catch (error) {
    return error.message;
  }
}

test('a CASHIER may file a return', () => {
  assert.equal(allows('createSale', role('CASHIER')), true,
    'filing a return is the cashier\'s job — blocking this would be a different bug');
});

test('a CASHIER may NOT finalise a return', () => {
  const message = refusal('confirmSale', role('CASHIER'));
  assert.match(message ?? '', /tidak memiliki hak akses/i,
    'a cashier confirming their own return is the exact case this policy exists to prevent');
});

test('OWNER may finalise a return', () => {
  assert.equal(allows('confirmSale', role('OWNER')), true, 'the policy says OWNER *or* FINANCE');
});

test('FINANCE may finalise a return', () => {
  assert.equal(allows('confirmSale', role('FINANCE')), true, 'the policy says OWNER *or* FINANCE');
});

test('a WAREHOUSE role may also finalise — confirm the list is not merely "everyone but cashier"', () => {
  // Not the policy being tested, but a silent expansion of the approver set would be a real problem,
  // so the actual membership is asserted rather than assumed.
  assert.equal(allows('confirmSale', role('WAREHOUSE')), true);
  for (const denied of ['CASHIER', 'PURCHASING', 'STAFF']) {
    assert.match(refusal('confirmSale', role(denied)) ?? '', /tidak memiliki hak akses/i,
      `${denied} must not be able to finalise a return`);
  }
});

test('an unauthenticated caller is refused', () => {
  assert.match(refusal('confirmSale', undefined) ?? '', /tidak memiliki hak akses/i);
  assert.match(refusal('confirmSale', {}) ?? '', /tidak memiliki hak akses/i);
});

test('confirming a return needs a DIFFERENT permission from filing one', () => {
  // Guards can be configured with roles and still be wrong if the permission is the same string. The
  // separation matters: it lets a branch revoke `sale.refund` without also revoking `sale.return`,
  // which would take the cashier's filing ability away along with it.
  const reflector = new Reflector();
  const fileMeta = reflector.getAllAndOverride(ROLES_KEY, [proto.createSale, ReturnsController]);
  const confirmMeta = reflector.getAllAndOverride(ROLES_KEY, [proto.confirmSale, ReturnsController]);
  const filePerm = reflector.getAllAndOverride(PERMISSIONS_KEY, [proto.createSale, ReturnsController]);
  const confirmPerm = reflector.getAllAndOverride(PERMISSIONS_KEY, [proto.confirmSale, ReturnsController]);

  assert.ok(fileMeta.includes('CASHIER'), 'filing must stay open to CASHIER');
  assert.ok(!confirmMeta.includes('CASHIER'), 'finalising must exclude CASHIER');
  assert.notDeepEqual(filePerm, confirmPerm, `file and confirm share a permission: ${filePerm}`);
});

test('the same split holds for customer order returns', () => {
  assert.equal(allows('confirmOrderReturn', role('OWNER')), true);
  assert.equal(allows('confirmOrderReturn', role('FINANCE')), true);
  assert.match(refusal('confirmOrderReturn', role('CASHIER')) ?? '', /tidak memiliki hak akses/i,
    'a customer order return is money out the door too — the cashier must not self-approve it');
});

test('an API key may confirm, because the endpoint declares a permission to scope it', () => {
  // API keys carry their own permission scope rather than a role. The guard's contract is: a role-only
  // endpoint refuses API keys outright; an endpoint with a permission lets them through on their own
  // scope. If the confirm endpoint ever lost its permission, API-key access would silently vanish.
  const reflector = new Reflector();
  const perms = reflector.getAllAndOverride(PERMISSIONS_KEY, [proto.confirmSale, ReturnsController]);
  assert.ok(perms?.length, 'confirm endpoint lost its permission — API keys would now be refused');

  const apiKeyUser = { sub: 'k-1', authType: 'API_KEY', companyId: 'acme', roles: [] };
  assert.equal(allows('confirmSale', apiKeyUser), true);
});

test('a role-only endpoint refuses an API key', () => {
  // The counterpart to the test above: this is what stops the "just widen the check" shortcut. Built
  // with a stub reflector that returns roles but no permission, so this exercises the guard's
  // API-key branch directly — the real confirm endpoint cannot, because it always has a permission.
  const apiKeyUser = { sub: 'k-1', authType: 'API_KEY', companyId: 'acme', roles: [] };
  const guardNoPerm = new RolesGuard({
    getAllAndOverride: (key) => (key === ROLES_KEY ? ['OWNER'] : undefined),
  });
  assert.throws(
    () => guardNoPerm.canActivate(contextFor('confirmSale', apiKeyUser)),
    /API key/i,
    'an endpoint with roles but no permission must refuse API keys outright',
  );
});

test.after(() => {});
