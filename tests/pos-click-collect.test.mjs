// Click & Collect from the POS.
//
// `Order.fulfillmentType = 'PICKUP'` and `pickupWarehouseId` already existed and were fully wired in
// the storefront and Admin. What was missing was the cashier's side, and the reason it is not a thin
// wrapper over the existing sale endpoint is the inventory consequence:
//
//   A POS sale posts an inventory movement and decrements the warehouse it sells from. Paying at
//   Branch A for goods physically sitting at Branch B would make A's books say it is short a unit it
//   still holds, and leave B unable to fulfil. So the POS reserves through the ORDER pipeline and
//   must never route click-and-collect through /sales.
//
// The second constraint: the cross-branch stock endpoint is tenant-scoped. A shared inventory view
// that accepts a companyId without checking it is a cross-tenant inventory oracle, and the company
// list is small enough to enumerate.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = new URL('../', import.meta.url).pathname;
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const pos = read('apps/pos/app/page.tsx');
const module_ = await import('./helpers/import-ts.mjs').then((m) => m.load('apps/pos/lib/click-collect.ts'));
const controller = read('apps/api/src/inventory/cross-branch-stock.controller.ts');
const inventoryModule = read('apps/api/src/inventory/inventory.module.ts');

test('a pickup is reserved through the ORDER pipeline, never sold through /sales', () => {
  // The whole design rests on this. A /sales call would decrement the paying branch's stock.
  const collect = pos.slice(pos.indexOf('async function submitPickup'), pos.indexOf('function openCollectFor') + 4000);
  assert.match(collect, /api<PickupQuote>\('\/orders'/, 'pickup must go through /orders');
  assert.doesNotMatch(collect, /'\/sales'/, 'and must never create a POS sale for stock held elsewhere');
  assert.match(collect, /fulfillmentType: 'PICKUP'/);
});

test('the cross-branch stock view is tenant-scoped and refuses a foreign companyId', () => {
  // Enumerable: a company list is short, so an unchecked companyId turns this into a lookup of what
  // every other company in the platform is holding.
  assert.match(controller, /user\.companyId !== scopeCompanyId/);
  assert.match(controller, /Hanya boleh melihat stok cabang dalam perusahaan sendiri/);
  // Scope in the query itself, not filtered afterwards — a later refactor must not drop it.
  assert.match(controller, /productId, warehouse: \{ branch: \{ companyId: scopeCompanyId \} \}/);
  assert.match(controller, /where: \{ id: productId, companyId: scopeCompanyId \}/);
  assert.ok(!/code: '4102'/.test(controller), 'sanity: reading the accounting seed by mistake');
});

test('the current branch comes from the session, not from a query parameter', () => {
  // Otherwise a cashier hides the branch that has the stock and tells the customer it is unavailable.
  assert.match(controller, /user\.branchId \? this\.prisma\.branch\.findFirst/);
  assert.doesNotMatch(controller, /@Query\('branchId'\)/,
    'the "which branch am I" question must not be answerable by the caller');
  assert.match(controller, /isCurrent: branch\.id === currentBranch\?\.id/);
});

test('stock is summed per branch across its warehouses', () => {
  // Three shelves with 2 each is 6 available, not 2. Reporting per-warehouse makes the cashier tell a
  // customer an in-stock item is out of stock.
  assert.match(controller, /if \(existing\) existing\.available \+= row\.available;/);
  // And when stock is spread over several warehouses there is no single collection point, so the id
  // is null rather than an arbitrary one — sending the customer to the wrong shelf wastes the trip.
  assert.match(controller, /warehouseId: null,/);
  assert.match(controller, /Null when stock is spread over several warehouses/);
});

test('planPickup only offers branches that can actually fill the order', () => {
  const stock = [
    { branchId: 'a', branchCode: 'A', branchName: 'Cabang A', warehouseId: null, available: 10, isCurrent: true },
    { branchId: 'b', branchCode: 'B', branchName: 'Cabang B', warehouseId: 'w1', available: 3, isCurrent: false },
    { branchId: 'c', branchCode: 'C', branchName: 'Cabang C', warehouseId: 'w2', available: 9, isCurrent: false },
    { branchId: 'd', branchCode: 'D', branchName: 'Cabang D', warehouseId: 'w3', available: 1, isCurrent: false },
  ];
  const ok = module_.planPickup(stock, 2);
  assert.equal(ok.canCollect, true);
  assert.deepEqual(ok.alternatives.map((r) => r.branchCode), ['C', 'B'], 'most stock first, and the current branch is never an alternative');
  assert.ok(!ok.alternatives.some((r) => r.isCurrent), 'the branch the customer is standing in is not a pickup branch');

  // Quantity 5: C has 9 so it can fill, B has 3 and D has 1 so neither can. The verdict is yes, and
  // only C is offered — a branch that can only supply part of the order is not an option, because
  // the customer arrives expecting five items and finds three.
  const partial = module_.planPickup(stock, 5);
  assert.equal(partial.canCollect, true);
  assert.deepEqual(partial.alternatives.map((r) => r.branchCode), ['C'], 'only branches that can fill the whole order are listed');

  // Quantity 12: nothing anywhere has that much, and the reason must name the shortfall rather than
  // saying "no branches configured", which sends the cashier looking for a settings problem.
  const short = module_.planPickup(stock, 12);
  assert.equal(short.canCollect, false);
  assert.match(short.reason, /tidak cukup/);

  // Nothing anywhere: say so plainly rather than "no branches configured".
  const none = module_.planPickup([stock[0]], 1);
  assert.equal(none.canCollect, false);
  assert.match(none.reason, /Tidak ada cabang lain/);
});

test('the voucher carries the code the collecting branch can act on', () => {
  // The whole trip is wasted if this code is empty or truncated — staff at the other branch have
  // nothing to scan and nothing to look up.
  const lines = module_.pickupVoucherLines(
    { orderNumber: 'ORD/2026/0001', pickupBranchCode: 'B', pickupWarehouseId: 'w1', total: 150000, shippingCost: 0, status: 'PAID', pickupCode: 'PC-8842' },
    'Cabang A',
  );
  const text = lines.join('\n');
  assert.ok(text.includes('PC-8842'), 'the pickup code must be on the voucher');
  assert.ok(text.includes('ORD/2026/0001'));
  assert.ok(text.includes('Cabang A'), 'and where it was paid, so staff can verify');
  // Ongkos only shown when there is one, so a zero-fee pickup is not listed as "Ongkir: 0".
  assert.ok(!text.includes('Ongkir'));
  const withShipping = module_.pickupVoucherLines(
    { orderNumber: 'O2', pickupBranchCode: 'B', pickupWarehouseId: null, total: 100, shippingCost: 15000, status: 'PAID', pickupCode: 'X' },
    'A',
  ).join('\n');
  assert.ok(withShipping.includes('Ongkir'));
});

test('the POS reaches the endpoint it declares, and the module provides it', () => {
  assert.match(pos, /\/inventory\/cross-branch-stock\//);
  assert.match(pos, /Ambil di cabang lain/);
  // Nest fails at BOOT, not at build, on a controller that is not registered or a module that does
  // not provide an injected service. Asserting only the import name was not enough: the earlier
  // version of this test matched the identifier, so removing it from `controllers` stayed green —
  // which is exactly the bug the boot probe exists to catch. Match the array contents instead.
  assert.match(inventoryModule, /import \{ CrossBranchStockController \} from '\.\/cross-branch-stock\.controller';/);
  assert.match(inventoryModule, /controllers: \[[^\]]*CrossBranchStockController[^\]]*\]/,
    'the controller must be in the module controllers array, or the route 404s at runtime');
  assert.match(inventoryModule, /imports: \[PrismaModule\]/,
    'the controller injects PrismaService directly, so the module must import it');
});
