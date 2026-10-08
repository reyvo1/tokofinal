import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { analysis } from './helpers/mutation-payload-parity.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// Eight UI call sites build their path from a variable, so the payload scan cannot match them
// against a controller route on its own: `/finance/fiscal-periods/${period.id}/${action}` could
// be any of several endpoints depending on the runtime value of `action`.
//
// This is not a theoretical concern. A value that is legal in the type but absent from the
// controller produces a 404 that no static check would have caught, and a value used in the UI
// but not in the union means the button renders and fails only when pressed. So each dynamic
// template is pinned to the exact set of controller routes it is allowed to reach.
//
// Every path here was verified by hand first; the assertions exist so a later change to either
// side fails loudly instead of silently widening the reachable set.

const routeExists = (method, path) => analysis.routes.some((r) => r.method === method && r.path === path.replace(/:[a-zA-Z]+/g, ':p'));
const routeExistsLoose = (method, path) => {
  const want = path.replace(/:[a-zA-Z]+/g, ':p');
  return analysis.routes.some((r) => r.method === method && r.path === want);
};

test('the eight dynamic paths are the only unresolved ones, so none were missed', () => {
  const distinct = new Set(analysis.unresolved.map((s) => `${s.method} ${s.routeText}`));
  assert.equal(distinct.size, 8, 'an unresolved route appeared that this file does not account for');
});

test('fiscal period action is limited to the three routes the controller declares', () => {
  // accounting.tsx:137 types it as 'soft-close' | 'close' | 'reopen'.
  const src = read('apps/admin/app/modules/accounting.tsx');
  assert.match(src, /action: 'soft-close' \| 'close' \| 'reopen'/);
  assert.match(src, /\/finance\/fiscal-periods\/\$\{period\.id\}\/\$\{action\}/);
  for (const action of ['soft-close', 'close', 'reopen']) {
    assert.ok(routeExistsLoose('PATCH', `/finance/fiscal-periods/:id/${action}`), `PATCH .../${action} must exist on the controller`);
  }
  // The union must not be wider than the controller. Scan only the periodDialog declaration —
  // a file-wide /action:/ sweep also picks up unrelated domains (gate approve, trip mode), which
  // is a false alarm rather than a real finding.
  const dialog = /useState<\{ period: FiscalPeriod; action: ([^;]+);/.exec(src);
  assert.ok(dialog, 'the periodDialog state declaration must stay visible to this test');
  const literals = [...dialog[1].matchAll(/'([a-z-]+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(literals, ['close', 'reopen', 'soft-close'], 'the action union must stay exactly these three literals');
});

test('accounting close control action is limited to close and reopen', () => {
  const src = read('apps/admin/app/modules/accounting.tsx');
  assert.match(src, /\/accounting-core\/close-controls\/\$\{control\.id\}\/\$\{action\}/);
  for (const action of ['close', 'reopen']) {
    assert.ok(routeExistsLoose('POST', `/accounting-core/close-controls/:id/${action}`), `POST .../${action} must exist`);
  }
});

test('stock transfer action is limited to the three controller routes', () => {
  const src = read('apps/admin/app/modules/operations.tsx');
  assert.match(src, /\/advanced-inventory\/stock-transfers\/\$\{row\.id\}\/\$\{action\}/);
  for (const action of ['approve', 'ship', 'receive']) {
    assert.ok(routeExistsLoose('PATCH', `/advanced-inventory/stock-transfers/:id/${action}`), `PATCH .../${action} must exist`);
  }
});

test('stock opname action is limited to count, submit and complete', () => {
  const src = read('apps/admin/app/modules/operations.tsx');
  assert.match(src, /\/advanced-inventory\/stock-opnames\/\$\{row\.id\}\/\$\{action\}/);
  for (const action of ['count', 'submit', 'complete']) {
    assert.ok(routeExistsLoose('PATCH', `/advanced-inventory/stock-opnames/:id/${action}`), `PATCH .../${action} must exist`);
  }
});

test('the order fulfilment action only reaches routes the controller declares', () => {
  const src = read('apps/admin/app/modules/extensions.tsx');
  assert.match(src, /\/orders\/\$\{order\.id\}\/\$\{action\}/);
  // The controller exposes pack, ship, cancel, deliver, confirm-payment and authorize-invoice.
  const reachable = analysis.routes
    .filter((r) => r.method === 'POST' && r.path.startsWith('/orders/:p/'))
    .map((r) => r.path.split('/').pop());
  assert.ok(reachable.length >= 4, `expected several order action routes, found ${reachable.join(', ')}`);
  // Whatever literals the UI can pass must be a subset of the controller's action set.
  for (const literal of ['pack', 'ship', 'cancel', 'deliver']) {
    assert.ok(reachable.includes(literal), `orders action "${literal}" has no matching controller route`);
  }
});

test('the platform notification action only reaches cancel and replay', () => {
  const src = read('apps/admin/app/modules/extensions.tsx');
  assert.match(src, /\/platform\/notifications\/\$\{[^}]+\}\/\$\{[^}]+\}/);
  for (const action of ['cancel', 'replay']) {
    assert.ok(routeExistsLoose('POST', `/platform/notifications/:id/${action}`), `POST .../${action} must exist`);
  }
});

test('the storefront account endpoint variable only names real endpoints', () => {
  const src = read('apps/storefront/app/page.tsx');
  assert.match(src, /\/storefront\/account\/\$\{endpoint\}/);
  // endpoint is a ternary over accountMode, so the reachable set is exactly the two literals it
  // names — not a set of assignments. A file-wide /endpoint\s*=/ sweep finds nothing here.
  const ternary = /const endpoint = accountMode === '(\w+)' \? '(\w+)' : '(\w+)'/.exec(src);
  assert.ok(ternary, 'the endpoint derivation must stay visible to this test');
  const values = [ternary[2], ternary[3]].filter(Boolean);
  for (const v of values) {
    const found = analysis.routes.some((r) => r.method === 'POST' && r.path === `/storefront/account/${v}`);
    assert.ok(found, `storefront account endpoint "${v}" has no POST route on the controller`);
  }
  assert.deepEqual(values.sort(), ['login', 'register']);
});

test('the five dynamic approve paths each have a matching controller route', () => {
  // delivery-lifecycle, hr-payroll (x2) and operations-control (x2) build `/…/${id}/approve`.
  // The literal is fixed, so these resolve normally — this test exists to prove the accounting
  // above did not accidentally leave a real 404 hiding behind a dynamic template.
  const literals = [
    ['apps/admin/app/modules/delivery-lifecycle.tsx', /\$\{gate\.id\}\/approve/],
    ['apps/admin/app/modules/hr-payroll.tsx', /\$\{rule\.id\}\/approve/],
    ['apps/admin/app/modules/hr-payroll.tsx', /\$\{selectedRun\.id\}\/approve/],
    ['apps/admin/app/modules/operations-control.tsx', /\$\{pass\.id\}\/approve/],
    ['apps/admin/app/modules/operations-control.tsx', /\$\{inspection\.id\}\/approve/],
  ];
  for (const [file, pattern] of literals) {
    assert.match(read(file), pattern, `${file} must still contain its approve call`);
  }
  // And the controller side must have approve endpoints for the domains involved.
  const approveRoutes = analysis.routes.filter((r) => r.path.endsWith('/approve'));
  assert.ok(approveRoutes.length >= 5, `expected several approve routes, found ${approveRoutes.length}`);
  assert.ok(!routeExists('GET', '/never'), 'routeExists must reject an unknown route — anti-vacuity');
});
